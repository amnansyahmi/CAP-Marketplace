/**
 * Tests for the pieces a shop needs before it can open to the public.
 *
 * The theme is not lying to people: a limiter that lets everything through, a
 * newsletter that forgets an opt-out, and a lookup form that confirms which
 * order references exist are each a promise broken in a different place.
 */

process.env.PGLITE_MEMORY = "1";
delete process.env.DATABASE_URL;
process.env.ORDER_ACCESS_SECRET = "test-order-access-secret-value";

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db/client";
import { rateLimit, resetRateLimitsForTests } from "@/lib/rate-limit";
import { missingShopDetails, shopDetails, whatsappLink } from "@/lib/shop";
import {
  listSubscribers,
  normaliseEmail,
  subscribe,
  unsubscribe,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from "@/lib/subscribers";
import { lowStock, salesReport } from "@/lib/reporting";
import { orderStore, type NewOrder } from "@/lib/orders";
import { setStock, stockLevels } from "@/lib/stock";

const env = process.env as Record<string, string | undefined>;

function draft(overrides: Partial<NewOrder> = {}): NewOrder {
  return {
    items: [{ productId: "kabsah", name: "Kabsah Paste", unitPrice: 19.9, quantity: 2, lineTotal: 39.8 }],
    customer: { fullName: "Test Buyer", email: "buyer@example.com", phone: "012-345 6789" },
    address: { line1: "1 Jalan Ujian", postcode: "55100", city: "Kuala Lumpur", state: "Kuala Lumpur" },
    subtotal: 39.8,
    shipping: 8,
    total: 47.8,
    currency: "MYR",
    ...overrides,
  };
}

before(async () => {
  await getDb();
});

beforeEach(() => resetRateLimitsForTests());

describe("rate limiting", () => {
  it("allows traffic up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      assert.equal(rateLimit("k", { limit: 5, windowMs: 1000 }).allowed, true, `call ${i + 1}`);
    }
  });

  it("refuses the one after", () => {
    for (let i = 0; i < 5; i++) rateLimit("k", { limit: 5, windowMs: 1000 });
    const result = rateLimit("k", { limit: 5, windowMs: 1000 });
    assert.equal(result.allowed, false);
    assert.ok(result.allowed === false && result.retryInMs > 0);
  });

  it("keeps separate callers separate", () => {
    for (let i = 0; i < 5; i++) rateLimit("one", { limit: 5, windowMs: 1000 });
    // One noisy client must not lock everybody else out of the shop.
    assert.equal(rateLimit("two", { limit: 5, windowMs: 1000 }).allowed, true);
  });

  it("lets a caller back in once the window passes", () => {
    const start = 1_000_000;
    for (let i = 0; i < 5; i++) rateLimit("k", { limit: 5, windowMs: 1000 }, start);
    assert.equal(rateLimit("k", { limit: 5, windowMs: 1000 }, start).allowed, false);
    assert.equal(rateLimit("k", { limit: 5, windowMs: 1000 }, start + 1001).allowed, true);
  });
});

describe("shop details", () => {
  it("reports what is missing rather than inventing it", () => {
    for (const key of [
      "NEXT_PUBLIC_SHOP_LEGAL_NAME",
      "NEXT_PUBLIC_SHOP_REGISTRATION",
      "NEXT_PUBLIC_SHOP_EMAIL",
      "NEXT_PUBLIC_SHOP_PHONE",
      "NEXT_PUBLIC_SHOP_ADDRESS",
    ]) {
      delete env[key];
    }
    const missing = missingShopDetails(shopDetails());
    // A policy page that names a plausible-looking business nobody can reach is
    // worse than one that admits it is incomplete.
    assert.ok(missing.includes("registered business name"));
    assert.ok(missing.includes("SSM registration number"));
    assert.equal(shopDetails().legalName, undefined);
  });

  it("reads a multi-line address from one variable", () => {
    env.NEXT_PUBLIC_SHOP_ADDRESS = "12 Jalan Dapur | Taman Selera | 55100 Kuala Lumpur";
    assert.deepEqual(shopDetails().addressLines, ["12 Jalan Dapur", "Taman Selera", "55100 Kuala Lumpur"]);
    delete env.NEXT_PUBLIC_SHOP_ADDRESS;
  });

  it("builds a WhatsApp link from a formatted number", () => {
    env.NEXT_PUBLIC_SHOP_WHATSAPP = "+60 12-345 6789";
    assert.equal(whatsappLink(), "https://wa.me/60123456789");
    delete env.NEXT_PUBLIC_SHOP_WHATSAPP;
  });
});

describe("newsletter subscribers", () => {
  let counter = 0;
  const address = () => `person${counter++}@example.com`;

  it("records a sign-up", async () => {
    const email = address();
    const result = await subscribe(email);
    assert.equal(result.ok, true);

    const { subscribers } = await listSubscribers();
    assert.ok(subscribers.some((s) => s.email === email && !s.unsubscribedAt));
  });

  it("treats a repeat sign-up as the same one", async () => {
    const email = address();
    await subscribe(email);
    const again = await subscribe(email);
    // People forget. Signing up twice is not an error and must not create two
    // rows or two emails.
    assert.equal(again.ok, true);

    const { subscribers } = await listSubscribers();
    assert.equal(subscribers.filter((s) => s.email === email).length, 1);
  });

  it("remembers an opt-out instead of deleting the row", async () => {
    const email = address();
    await subscribe(email);
    assert.equal(await unsubscribe(email), true);

    const { subscribers } = await listSubscribers();
    const row = subscribers.find((s) => s.email === email);
    // Deleting would let the next sign-up silently re-add someone who asked to
    // be left alone.
    assert.ok(row, "the record is kept");
    assert.ok(row?.unsubscribedAt, "and marked as opted out");
  });

  it("counts an unsubscribed address as inactive", async () => {
    const email = address();
    await subscribe(email);
    const before = (await listSubscribers()).active;
    await unsubscribe(email);
    assert.equal((await listSubscribers()).active, before - 1);
  });

  it("lets someone come back if they change their mind", async () => {
    const email = address();
    await subscribe(email);
    await unsubscribe(email);
    await subscribe(email);

    const { subscribers } = await listSubscribers();
    assert.equal(subscribers.find((s) => s.email === email)?.unsubscribedAt, undefined);
  });

  it("unsubscribing twice is not an error", async () => {
    const email = address();
    await subscribe(email);
    assert.equal(await unsubscribe(email), true);
    assert.equal(await unsubscribe(email), false);
  });

  it("rejects anything that is not an address", () => {
    for (const raw of ["", "  ", "nope", "a@b", "@example.com", "person@", "a".repeat(300)]) {
      assert.equal(normaliseEmail(raw), null, raw);
    }
    assert.equal(normaliseEmail("  Person@Example.COM "), "person@example.com");
  });
});

describe("unsubscribe links", () => {
  it("accepts the token issued for that address", () => {
    const token = unsubscribeToken("person@example.com");
    assert.ok(token);
    assert.equal(verifyUnsubscribeToken("person@example.com", token), true);
  });

  it("refuses a token pointed at somebody else", () => {
    const mine = unsubscribeToken("mine@example.com");
    assert.ok(mine);
    // Without this, every marketing email would hand out the ability to
    // unsubscribe anyone by editing the address in the URL.
    assert.equal(verifyUnsubscribeToken("victim@example.com", mine), false);
  });

  it("refuses a missing or junk token", () => {
    for (const token of [undefined, "", "not-a-token"]) {
      assert.equal(verifyUnsubscribeToken("person@example.com", token), false);
    }
  });
});

describe("reporting", () => {
  it("covers every day in the window, including quiet ones", async () => {
    const report = await salesReport(7);
    // A chart that skips days with no orders reads as busier than the shop is.
    assert.equal(report.days.length, 7);
  });

  it("counts a paid order and leaves a refunded one out", async () => {
    const before = await salesReport(30);

    const counted = await orderStore.create(draft());
    await orderStore.setStatus(counted.id, "paid");

    const refunded = await orderStore.create(draft());
    await orderStore.setStatus(refunded.id, "paid");
    await orderStore.refund(refunded.id);

    const after = await salesReport(30);
    assert.equal(after.orders - before.orders, 1, "one order counted, not two");
    assert.equal(Math.round((after.revenue - before.revenue) * 100) / 100, 47.8);
  });

  it("works out an average order value", async () => {
    const report = await salesReport(30);
    if (report.orders > 0) {
      assert.equal(report.averageOrderValue, Math.round((report.revenue / report.orders) * 100) / 100);
    }
  });

  it("has no average to divide by when nothing sold", async () => {
    const report = await salesReport(1);
    if (report.orders === 0) assert.equal(report.averageOrderValue, 0);
  });

  it("ranks best sellers by units", async () => {
    const report = await salesReport(30);
    for (let i = 1; i < report.bestSellers.length; i++) {
      assert.ok(report.bestSellers[i - 1].units >= report.bestSellers[i].units);
    }
  });
});

describe("low stock warnings", () => {
  beforeEach(async () => {
    for (const level of await stockLevels()) {
      await setStock(level.productId, { tracked: false, onHand: 0 });
    }
  });

  it("says nothing about products the shop does not count", async () => {
    // An untracked product has no number to be low against, and warning about
    // it would be noise the owner learns to ignore.
    assert.deepEqual(await lowStock(), []);
  });

  it("warns when a tracked product runs low", async () => {
    await setStock("kabsah", { tracked: true, onHand: 3 });
    const low = await lowStock(5);
    assert.equal(low.length, 1);
    assert.equal(low[0].productId, "kabsah");
    assert.equal(low[0].available, 3);
  });

  it("stays quiet when there is plenty", async () => {
    await setStock("kabsah", { tracked: true, onHand: 40 });
    assert.deepEqual(await lowStock(5), []);
  });

  it("puts the most urgent first", async () => {
    await setStock("kabsah", { tracked: true, onHand: 4 });
    await setStock("mandy", { tracked: true, onHand: 1 });
    const low = await lowStock(5);
    assert.equal(low[0].productId, "mandy");
  });
});
