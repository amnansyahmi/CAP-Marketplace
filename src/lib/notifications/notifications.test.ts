/**
 * Notification tests.
 *
 * The question that matters: can a customer be emailed twice about the same
 * thing? Payment gateways retry callbacks, and an admin can click a fulfilment
 * button more than once, so "we only call it once" is not a claim the code gets
 * to make about itself.
 */

process.env.PGLITE_MEMORY = "1";
delete process.env.DATABASE_URL;
process.env.ORDER_ACCESS_SECRET = "test-order-access-secret-value";
process.env.NEXT_PUBLIC_SITE_URL = "https://shop.example";

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db/client";
import { clearFailedClaim, dispatch, notificationsFor } from "@/lib/notifications/dispatch";
import { orderConfirmedEmail, orderShippedEmail, orderUrl } from "@/lib/notifications/templates";
import { orderStore, type NewOrder, type Order } from "@/lib/orders";

const env = process.env as Record<string, string | undefined>;

function draft(overrides: Partial<NewOrder> = {}): NewOrder {
  return {
    items: [{ productId: "kabsah", name: "Kabsah Paste", unitPrice: 19.9, quantity: 2, lineTotal: 39.8 }],
    customer: { fullName: "Siti Nurhaliza Yusof", email: "siti@example.com", phone: "012-345 6789" },
    address: { line1: "12 Jalan Ujian", postcode: "55100", city: "Kuala Lumpur", state: "Kuala Lumpur" },
    subtotal: 39.8,
    shipping: 8,
    total: 47.8,
    currency: "MYR",
    ...overrides,
  };
}

const message = (to = "siti@example.com") => ({
  to,
  subject: "Test",
  text: "Test body",
  html: "<p>Test body</p>",
});

before(async () => {
  await getDb();
});

beforeEach(() => {
  env.MAIL_DRIVER = "none";
});

describe("sending exactly once", () => {
  it("sends the first time", async () => {
    const order = await orderStore.create(draft());
    const result = await dispatch(order.id, "order_confirmed", message());
    assert.equal(result.sent, true);
  });

  it("refuses a second attempt for the same message", async () => {
    const order = await orderStore.create(draft());
    await dispatch(order.id, "order_confirmed", message());
    const second = await dispatch(order.id, "order_confirmed", message());

    assert.equal(second.sent, false);
    assert.equal(second.sent === false && second.reason, "already_claimed");
  });

  it("survives callbacks arriving at the same moment", async () => {
    const order = await orderStore.create(draft());
    // The real shape of the problem: a gateway retrying before the first
    // response came back, so both requests are in flight together.
    const results = await Promise.all(
      Array.from({ length: 6 }, () => dispatch(order.id, "order_confirmed", message())),
    );
    const sent = results.filter((r) => r.sent);
    assert.equal(sent.length, 1, "exactly one of six concurrent attempts may send");
  });

  it("keeps different kinds independent", async () => {
    const order = await orderStore.create(draft());
    assert.equal((await dispatch(order.id, "order_confirmed", message())).sent, true);
    // A shipping notice is a different message; the confirmation must not
    // block it.
    assert.equal((await dispatch(order.id, "order_shipped", message())).sent, true);
  });

  it("keeps different orders independent", async () => {
    const one = await orderStore.create(draft());
    const two = await orderStore.create(draft());
    assert.equal((await dispatch(one.id, "order_confirmed", message())).sent, true);
    assert.equal((await dispatch(two.id, "order_confirmed", message())).sent, true);
  });
});

describe("recording what happened", () => {
  it("records a successful send", async () => {
    const order = await orderStore.create(draft());
    await dispatch(order.id, "order_confirmed", message());

    const [record] = await notificationsFor(order.id);
    assert.equal(record.status, "sent");
    assert.equal(record.recipient, "siti@example.com");
    assert.ok(record.sentAt);
  });

  it("records a failure instead of losing it", async () => {
    env.MAIL_DRIVER = "resend";
    env.RESEND_API_KEY = "definitely-not-a-real-key";
    const order = await orderStore.create(draft());

    try {
      const result = await dispatch(order.id, "order_confirmed", message());
      assert.equal(result.sent, false);

      const [record] = await notificationsFor(order.id);
      // A customer who was not told is the thing the shop most needs to know.
      assert.equal(record.status, "failed");
      assert.ok(record.error);
    } finally {
      delete env.RESEND_API_KEY;
      env.MAIL_DRIVER = "none";
    }
  });

  it("lets a failed message be retried, but not a sent one", async () => {
    const failed = await orderStore.create(draft());
    const sent = await orderStore.create(draft());

    env.MAIL_DRIVER = "resend";
    env.RESEND_API_KEY = "definitely-not-a-real-key";
    await dispatch(failed.id, "order_confirmed", message());
    env.MAIL_DRIVER = "none";
    delete env.RESEND_API_KEY;
    await dispatch(sent.id, "order_confirmed", message());

    assert.equal(await clearFailedClaim(failed.id, "order_confirmed"), true);
    // Clearing a delivered message would be a way to email a customer twice.
    assert.equal(await clearFailedClaim(sent.id, "order_confirmed"), false);

    assert.equal((await dispatch(failed.id, "order_confirmed", message())).sent, true);
  });

  it("does not throw when the order does not exist", async () => {
    // Bookkeeping failure must never propagate into a payment path.
    const result = await dispatch("00000000-0000-0000-0000-000000000000", "order_confirmed", message());
    assert.equal(result.sent, false);
  });
});

describe("the emails themselves", () => {
  let order: Order;

  before(async () => {
    const created = await orderStore.create(draft());
    order = (await orderStore.setStatus(created.id, "paid")) ?? created;
  });

  it("carries an access token in every link", () => {
    const url = orderUrl(order.reference);
    assert.ok(url.includes("?t="), "a bare reference no longer opens the order page");
    assert.ok(url.startsWith("https://shop.example/orders/"));
  });

  it("states the total the customer was actually charged", () => {
    const email = orderConfirmedEmail(order);
    // RM 47.80, not the RM 39.80 subtotal — telling someone the wrong figure
    // for their own payment is the fastest way to lose their trust.
    assert.ok(email.text.includes("47.80"));
    assert.ok(email.html.includes("47.80"));
  });

  it("has a real plain-text part, not a stub", () => {
    const email = orderConfirmedEmail(order);
    assert.ok(email.text.includes(order.reference));
    assert.ok(email.text.includes("Kabsah Paste"));
    assert.ok(email.text.includes("12 Jalan Ujian"));
    assert.ok(!email.text.includes("<"), "the text part must not contain markup");
  });

  it("escapes customer-supplied values in the HTML part", async () => {
    const created = await orderStore.create(
      draft({
        customer: {
          fullName: '<script>alert("xss")</script> Ali',
          email: "ali@example.com",
          phone: "012-000 0000",
        },
      }),
    );
    const email = orderConfirmedEmail(created);
    assert.ok(!email.html.includes("<script>"), "a name goes into the email as text, not markup");
    assert.ok(email.html.includes("&lt;script&gt;"));
  });

  it("includes the tracking number once there is one", async () => {
    const created = await orderStore.create(draft());
    const paid = await orderStore.setStatus(created.id, "paid");
    assert.ok(paid);
    const shipped = await orderStore.setFulfilment(paid.id, "shipped", "EP123456789MY");
    assert.ok(shipped);

    const email = orderShippedEmail(shipped);
    assert.ok(email.text.includes("EP123456789MY"));
    assert.ok(email.html.includes("EP123456789MY"));
  });

  it("still reads sensibly with no tracking number", async () => {
    const created = await orderStore.create(draft());
    const paid = await orderStore.setStatus(created.id, "paid");
    assert.ok(paid);
    const shipped = await orderStore.setFulfilment(paid.id, "shipped");
    assert.ok(shipped);

    const email = orderShippedEmail(shipped);
    assert.ok(!email.text.includes("Tracking number:"));
    assert.ok(email.text.includes("on its way"));
  });
});
