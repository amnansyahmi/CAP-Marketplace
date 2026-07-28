/**
 * Order persistence tests.
 *
 * These run against real Postgres (PGlite, in-memory), so the statements
 * exercised here are the same ones that run against Supabase in production.
 *
 * The invariants covered are the ones where a bug costs money: totals must
 * round-trip exactly, a settled order must not be reversible, and concurrent
 * gateway callbacks must resolve to one outcome.
 */

process.env.PGLITE_MEMORY = "1";
delete process.env.DATABASE_URL;

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import { closeDb, getDb } from "@/lib/db/client";
import { orderStore, type NewOrder } from "@/lib/orders";
import { quoteShipping, round } from "@/lib/shipping";

function draft(overrides: Partial<NewOrder> = {}): NewOrder {
  return {
    items: [
      { productId: "kabsah", name: "Kabsah Paste", unitPrice: 19.9, quantity: 2, lineTotal: 39.8 },
    ],
    customer: { fullName: "Nur Amina", email: "amina@example.com", phone: "012-345 6789" },
    address: {
      line1: "12 Jalan Bukit Bintang",
      postcode: "55100",
      city: "Kuala Lumpur",
      state: "Kuala Lumpur",
    },
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

describe("persistence", () => {
  it("stores an order and reads it back by reference", async () => {
    const created = await orderStore.create(draft());
    assert.match(created.reference, /^CA-[0-9A-Z]{6}$/);
    assert.equal(created.status, "pending_payment");

    const found = await orderStore.byReference(created.reference);
    assert.ok(found, "order was not found after being created");
    assert.equal(found.id, created.id);
    assert.equal(found.customer.email, "amina@example.com");
    assert.equal(found.address.city, "Kuala Lumpur");
  });

  it("survives the database being closed and reopened — the point of the change", async () => {
    // Re-importing the module would prove nothing: ESM caches it, so the store
    // object would be identical. The only real test is to write with one
    // connection, drop it, and read with a new one against on-disk storage.
    const dir = mkdtempSync(join(tmpdir(), "chef-ammar-orders-"));
    const previous = { memory: process.env.PGLITE_MEMORY, dir: process.env.PGLITE_DIR };

    try {
      await closeDb();
      process.env.PGLITE_MEMORY = "0";
      process.env.PGLITE_DIR = dir;

      const created = await orderStore.create(draft());

      // Stands in for the server restarting.
      await closeDb();

      const found = await orderStore.byReference(created.reference);
      assert.ok(found, "the order did not survive the connection being closed");
      assert.equal(found.total, 47.8);
      assert.equal(found.items.length, 1);
      assert.equal(found.customer.email, "amina@example.com");
    } finally {
      await closeDb();
      if (previous.memory === undefined) delete process.env.PGLITE_MEMORY;
      else process.env.PGLITE_MEMORY = previous.memory;
      if (previous.dir === undefined) delete process.env.PGLITE_DIR;
      else process.env.PGLITE_DIR = previous.dir;
      rmSync(dir, { recursive: true, force: true });
      // Restore the shared in-memory database for the remaining tests.
      await getDb();
    }
  });

  it("keeps line items, in order", async () => {
    const created = await orderStore.create(
      draft({
        items: [
          { productId: "kabsah", name: "Kabsah Paste", unitPrice: 19.9, quantity: 1, lineTotal: 19.9 },
          { productId: "mandy", name: "Mandy Paste", unitPrice: 19.9, quantity: 3, lineTotal: 59.7 },
        ],
        subtotal: 79.6,
        shipping: 8,
        total: 87.6,
      }),
    );
    const found = await orderStore.byReference(created.reference);
    assert.equal(found?.items.length, 2);
    assert.deepEqual(
      found?.items.map((i) => i.productId),
      ["kabsah", "mandy"],
    );
    assert.equal(found?.items[1].quantity, 3);
    assert.equal(found?.items[1].lineTotal, 59.7);
  });

  it("returns undefined for an unknown reference rather than throwing", async () => {
    assert.equal(await orderStore.byReference("CA-NOPE00"), undefined);
  });
});

describe("money round-trips exactly", () => {
  it("preserves ringgit-and-sen amounts through the database", async () => {
    const created = await orderStore.create(
      draft({ subtotal: 19.9, shipping: 8, total: 27.9 }),
    );
    const found = await orderStore.byReference(created.reference);
    assert.equal(found?.subtotal, 19.9);
    assert.equal(found?.shipping, 8);
    assert.equal(found?.total, 27.9);
    assert.equal(found?.items[0].unitPrice, 19.9);
  });

  it("agrees with the shipping quote used at checkout", async () => {
    const quote = quoteShipping(39.8, "Kuala Lumpur");
    assert.ok(quote);
    const total = round(39.8 + quote.fee);
    const created = await orderStore.create(draft({ shipping: quote.fee, total }));
    const found = await orderStore.byReference(created.reference);
    assert.equal(found?.shipping, quote.fee);
    assert.equal(found?.total, total);
  });

  it("stores a free-delivery order as zero, not null", async () => {
    const created = await orderStore.create(draft({ subtotal: 199, shipping: 0, total: 199 }));
    const found = await orderStore.byReference(created.reference);
    assert.equal(found?.shipping, 0);
  });
});

describe("payment settlement", () => {
  it("attaches a payment without settling by default", async () => {
    const created = await orderStore.create(draft());
    const updated = await orderStore.attachPayment(created.id, {
      paymentId: "pay_1",
      paymentUrl: "https://gate.example/pay_1",
    });
    assert.equal(updated?.status, "pending_payment");
    assert.equal(updated?.paymentId, "pay_1");
    assert.equal(updated?.paidAt, undefined);
  });

  it("settles in the same write when asked", async () => {
    const created = await orderStore.create(draft());
    const updated = await orderStore.attachPayment(created.id, {
      paymentId: "pay_2",
      paymentUrl: "https://gate.example/pay_2",
      markPaid: true,
    });
    assert.equal(updated?.status, "paid");
    assert.ok(updated?.paidAt, "paidAt was not recorded");
  });

  it("finds an order by its gateway payment id", async () => {
    const created = await orderStore.create(draft());
    await orderStore.attachPayment(created.id, { paymentId: "pay_3", paymentUrl: "u" });
    const found = await orderStore.byPaymentId("pay_3");
    assert.equal(found?.id, created.id);
  });
});

describe("a settled order cannot be reversed", () => {
  it("refuses a late failure after payment", async () => {
    const created = await orderStore.create(draft());
    await orderStore.setStatus(created.id, "paid");

    const refused = await orderStore.setStatus(created.id, "failed");
    assert.equal(refused, undefined, "a paid order was moved to failed");

    const found = await orderStore.byReference(created.reference);
    assert.equal(found?.status, "paid");
  });

  it("refuses a late cancellation after payment", async () => {
    const created = await orderStore.create(draft());
    await orderStore.setStatus(created.id, "paid");
    assert.equal(await orderStore.setStatus(created.id, "cancelled"), undefined);
    assert.equal((await orderStore.byReference(created.reference))?.status, "paid");
  });

  it("treats a duplicate paid callback as a no-op, keeping the original time", async () => {
    const created = await orderStore.create(draft());
    const first = await orderStore.setStatus(created.id, "paid");
    const second = await orderStore.setStatus(created.id, "paid");
    assert.equal(second?.status, "paid");
    assert.equal(second?.paidAt, first?.paidAt, "a repeat callback moved paidAt");
  });

  it("still allows a failure before payment", async () => {
    const created = await orderStore.create(draft());
    const failed = await orderStore.setStatus(created.id, "failed");
    assert.equal(failed?.status, "failed");
  });

  it("resolves concurrent paid and failed callbacks to a single outcome", async () => {
    const created = await orderStore.create(draft());
    // Fired together, as two gateway retries can arrive.
    const [paid, failed] = await Promise.all([
      orderStore.setStatus(created.id, "paid"),
      orderStore.setStatus(created.id, "failed"),
    ]);
    const final = await orderStore.byReference(created.reference);
    assert.ok(final);
    // Whichever landed first wins, but the record must not be left in a state
    // neither callback asked for, and a paid order must stay paid.
    assert.ok(["paid", "failed"].includes(final.status));
    if (paid && failed) {
      assert.equal(final.status, "failed", "both writes applied; expected the later to be the record");
    }
    if (final.status === "paid") {
      assert.equal(await orderStore.setStatus(created.id, "failed"), undefined);
    }
  });

  it("returns undefined for an unknown order id", async () => {
    assert.equal(
      await orderStore.setStatus("00000000-0000-0000-0000-000000000000", "paid"),
      undefined,
    );
  });
});

describe("references are unique", () => {
  it("rejects a duplicate reference at the database level", async () => {
    const created = await orderStore.create(draft());
    const db = await getDb();
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO orders (id, reference, status, customer_full_name, customer_email,
             customer_phone, address_line1, address_postcode, address_city, address_state,
             subtotal, shipping, total, currency)
           VALUES ('11111111-1111-1111-1111-111111111111', $1, 'pending_payment', 'x','x@y.z','0',
             'l1','55100','KL','Kuala Lumpur', 1, 1, 2, 'MYR')`,
          [created.reference],
        ),
      (error: { code?: string }) => error.code === "23505",
      "a duplicate reference was accepted",
    );
  });

  it("generates distinct references across many orders", async () => {
    const refs = new Set<string>();
    for (let i = 0; i < 25; i++) refs.add((await orderStore.create(draft())).reference);
    assert.equal(refs.size, 25);
  });
});

describe("admin queries", () => {
  it("filters by payment status", async () => {
    const paid = await orderStore.create(draft());
    await orderStore.setStatus(paid.id, "paid");
    await orderStore.create(draft());

    const { orders } = await orderStore.list({ status: "paid", limit: 100 });
    assert.ok(orders.length > 0);
    assert.ok(orders.every((o) => o.status === "paid"), "a non-paid order came back from a paid filter");
    assert.ok(orders.some((o) => o.id === paid.id));
  });

  it("searches by reference, name and email", async () => {
    const created = await orderStore.create(
      draft({ customer: { fullName: "Zulkifli Rahman", email: "zul@example.com", phone: "012-000 0000" } }),
    );

    for (const term of [created.reference, "zulkifli", "zul@example.com"]) {
      const { orders } = await orderStore.list({ search: term, limit: 100 });
      assert.ok(orders.some((o) => o.id === created.id), `search for "${term}" missed the order`);
    }
  });

  it("is case-insensitive when searching", async () => {
    const created = await orderStore.create(
      draft({ customer: { fullName: "Siti Aminah", email: "SITI@Example.COM", phone: "012-000 0000" } }),
    );
    const { orders } = await orderStore.list({ search: "siti@example.com", limit: 100 });
    assert.ok(orders.some((o) => o.id === created.id));
  });

  it("treats a search term as data, not SQL", async () => {
    // If the term were interpolated this would drop the table.
    const { orders, total } = await orderStore.list({ search: "'; DROP TABLE orders; --", limit: 100 });
    assert.equal(orders.length, 0);
    assert.equal(total, 0);
    // Still usable afterwards.
    const check = await orderStore.create(draft());
    assert.ok(await orderStore.byReference(check.reference), "the orders table did not survive");
  });

  it("paginates without overlapping", async () => {
    for (let i = 0; i < 5; i++) await orderStore.create(draft());
    const first = await orderStore.list({ limit: 2, offset: 0 });
    const second = await orderStore.list({ limit: 2, offset: 2 });
    const overlap = first.orders.filter((a) => second.orders.some((b) => b.id === a.id));
    assert.equal(overlap.length, 0, "pages returned the same order twice");
    assert.ok(first.total >= 5);
  });

  it("returns line items with each listed order", async () => {
    await orderStore.create(draft());
    const { orders } = await orderStore.list({ limit: 5 });
    assert.ok(orders.every((o) => o.items.length > 0), "a listed order came back with no items");
  });

  it("counts revenue from settled orders only", async () => {
    const before = await orderStore.stats();

    const unpaid = await orderStore.create(draft({ total: 500 }));
    const afterUnpaid = await orderStore.stats();
    assert.equal(afterUnpaid.revenue, before.revenue, "an unpaid order was counted as revenue");

    await orderStore.setStatus(unpaid.id, "paid");
    const afterPaid = await orderStore.stats();
    assert.equal(afterPaid.revenue, before.revenue + 500);
    assert.equal(afterPaid.paidCount, before.paidCount + 1);
  });
});

describe("fulfilment", () => {
  it("refuses to fulfil an order that has not been paid", async () => {
    const created = await orderStore.create(draft());
    const refused = await orderStore.setFulfilment(created.id, "shipped");
    assert.equal(refused, undefined, "an unpaid order was marked shipped");
    assert.equal((await orderStore.byReference(created.reference))?.fulfilment, "unfulfilled");
  });

  it("moves a paid order through the steps and records tracking", async () => {
    const created = await orderStore.create(draft());
    await orderStore.setStatus(created.id, "paid");

    const packed = await orderStore.setFulfilment(created.id, "packed");
    assert.equal(packed?.fulfilment, "packed");

    const shipped = await orderStore.setFulfilment(created.id, "shipped", "MY123456789");
    assert.equal(shipped?.fulfilment, "shipped");
    assert.equal(shipped?.trackingNumber, "MY123456789");
    assert.ok(shipped?.fulfilmentUpdatedAt);
  });

  it("keeps the tracking number when a later step omits it", async () => {
    const created = await orderStore.create(draft());
    await orderStore.setStatus(created.id, "paid");
    await orderStore.setFulfilment(created.id, "shipped", "MY999");
    const delivered = await orderStore.setFulfilment(created.id, "delivered");
    assert.equal(delivered?.trackingNumber, "MY999", "tracking was cleared by a later update");
  });

  it("counts paid-but-unshipped orders as awaiting fulfilment", async () => {
    const before = (await orderStore.stats()).awaitingFulfilment;
    const created = await orderStore.create(draft());
    await orderStore.setStatus(created.id, "paid");
    assert.equal((await orderStore.stats()).awaitingFulfilment, before + 1);

    await orderStore.setFulfilment(created.id, "shipped");
    assert.equal((await orderStore.stats()).awaitingFulfilment, before, "a shipped order still counted as awaiting");
  });

  it("starts new orders unfulfilled", async () => {
    const created = await orderStore.create(draft());
    assert.equal(created.fulfilment, "unfulfilled");
  });
});
