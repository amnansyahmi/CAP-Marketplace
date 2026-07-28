/**
 * Affiliate and commission tests.
 *
 * Commission is a payable, so these assert the two rules that decide whether
 * the business pays the right amount: commission is taken on the subtotal
 * rather than the total, and the rate is frozen at order time.
 */

process.env.PGLITE_MEMORY = "1";
delete process.env.DATABASE_URL;

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { getDb } from "@/lib/db/client";
import { affiliateStore, commissionFor, normaliseCode, type Affiliate } from "@/lib/affiliates";
import { orderStore, type NewOrder } from "@/lib/orders";

let counter = 0;
const uniqueCode = (prefix = "REF") => `${prefix}${(counter++).toString().padStart(4, "0")}`;

function draft(overrides: Partial<NewOrder> = {}): NewOrder {
  return {
    items: [{ productId: "kabsah", name: "Kabsah Paste", unitPrice: 19.9, quantity: 2, lineTotal: 39.8 }],
    customer: { fullName: "Nur Amina", email: "amina@example.com", phone: "012-345 6789" },
    address: { line1: "12 Jalan Test", postcode: "55100", city: "Kuala Lumpur", state: "Kuala Lumpur" },
    subtotal: 39.8,
    shipping: 8,
    total: 47.8,
    currency: "MYR",
    ...overrides,
  };
}

/** Places an order attributed to an affiliate, the way the order API does. */
async function orderVia(affiliate: Affiliate, overrides: Partial<NewOrder> = {}) {
  const base = draft(overrides);
  return orderStore.create({
    ...base,
    affiliateId: affiliate.id,
    affiliateCode: affiliate.code,
    commissionRate: affiliate.commissionRate,
    commissionAmount: commissionFor(base.subtotal, affiliate.commissionRate),
  });
}

const newAffiliate = (rate = 0.1) =>
  affiliateStore.create({
    code: uniqueCode(),
    name: "Test Affiliate",
    email: `a${counter}@example.com`,
    commissionRate: rate,
  });

before(async () => {
  await getDb();
});

describe("referral codes", () => {
  it("normalises to uppercase", () => {
    assert.equal(normaliseCode("amina10"), "AMINA10");
    assert.equal(normaliseCode("  Amina-10 "), "AMINA-10");
  });

  it("rejects anything that could not be a code", () => {
    for (const bad of ["", "  ", "ab", "a".repeat(25), "bad code", "bad/code", "-LEADING", "TRAILING-", "<script>"]) {
      assert.equal(normaliseCode(bad), null, `accepted ${JSON.stringify(bad)}`);
    }
  });

  it("rejects a duplicate code", async () => {
    const code = uniqueCode("DUP");
    await affiliateStore.create({ code, name: "First", email: "f@example.com", commissionRate: 0.1 });
    await assert.rejects(
      () => affiliateStore.create({ code, name: "Second", email: "s@example.com", commissionRate: 0.2 }),
      (e: { code?: string }) => e.code === "23505",
    );
  });
});

describe("commission is taken on the subtotal, not the total", () => {
  it("excludes delivery", () => {
    // 10% of a 39.80 subtotal is 3.98. Including 8.00 delivery would give 4.78.
    assert.equal(commissionFor(39.8, 0.1), 3.98);
    assert.notEqual(commissionFor(39.8, 0.1), commissionFor(47.8, 0.1));
  });

  it("records commission from the subtotal when an order is placed", async () => {
    const affiliate = await newAffiliate(0.1);
    const order = await orderVia(affiliate, { subtotal: 39.8, shipping: 8, total: 47.8 });
    assert.equal(order.commissionAmount, 3.98, "commission was not 10% of the subtotal");
  });

  it("pays nothing extra on a free-delivery order", async () => {
    const affiliate = await newAffiliate(0.1);
    const order = await orderVia(affiliate, { subtotal: 199, shipping: 0, total: 199 });
    assert.equal(order.commissionAmount, 19.9);
  });

  it("rounds to sen", () => {
    assert.equal(commissionFor(19.9, 0.125), 2.49); // 2.4875
    assert.equal(commissionFor(59.7, 0.075), 4.48); // 4.4775
  });

  it("earns nothing at a zero rate", async () => {
    const affiliate = await newAffiliate(0);
    const order = await orderVia(affiliate);
    assert.equal(order.commissionAmount, 0);
  });
});

describe("the rate is frozen at order time", () => {
  it("does not rewrite an existing order when the rate changes", async () => {
    const affiliate = await newAffiliate(0.1);
    const order = await orderVia(affiliate);
    assert.equal(order.commissionAmount, 3.98);

    await affiliateStore.setRate(affiliate.id, 0.5);

    const reread = await orderStore.byReference(order.reference);
    assert.equal(reread?.commissionAmount, 3.98, "an existing order's commission changed with the rate");
    assert.equal(reread?.commissionRate, 0.1, "the snapshotted rate was overwritten");
  });

  it("applies the new rate to later orders", async () => {
    const affiliate = await newAffiliate(0.1);
    await orderVia(affiliate);
    const updated = await affiliateStore.setRate(affiliate.id, 0.2);
    assert.ok(updated);
    const later = await orderVia(updated);
    assert.equal(later.commissionAmount, 7.96, "the new rate was not applied to a later order");
  });
});

describe("only completed orders earn", () => {
  it("starts attributed orders pending", async () => {
    const affiliate = await newAffiliate();
    const order = await orderVia(affiliate);
    assert.equal(order.commissionStatus, "pending");
  });

  it("records no commission status for an unattributed order", async () => {
    const order = await orderStore.create(draft());
    assert.equal(order.commissionStatus, "none");
    assert.equal(order.commissionAmount, undefined);
  });

  it("voids commission when the order fails", async () => {
    const affiliate = await newAffiliate();
    const order = await orderVia(affiliate);
    await orderStore.setStatus(order.id, "failed");
    const reread = await orderStore.byReference(order.reference);
    assert.equal(reread?.commissionStatus, "void", "a failed order still owed commission");
  });

  it("voids commission when the order is cancelled", async () => {
    const affiliate = await newAffiliate();
    const order = await orderVia(affiliate);
    await orderStore.setStatus(order.id, "cancelled");
    assert.equal((await orderStore.byReference(order.reference))?.commissionStatus, "void");
  });

  it("excludes unpaid orders from what is owed", async () => {
    const affiliate = await newAffiliate(0.1);
    await orderVia(affiliate); // left unpaid
    const summary = await affiliateStore.summary(affiliate.code);
    assert.equal(summary?.commissionOwed, 0, "unpaid orders were counted as owed");
    assert.equal(summary?.orderCount, 0);
  });

  it("counts commission once the order is paid", async () => {
    const affiliate = await newAffiliate(0.1);
    const order = await orderVia(affiliate);
    await orderStore.setStatus(order.id, "paid");

    const summary = await affiliateStore.summary(affiliate.code);
    assert.equal(summary?.orderCount, 1);
    assert.equal(summary?.salesSubtotal, 39.8);
    assert.equal(summary?.commissionOwed, 3.98);
    assert.equal(summary?.commissionPaid, 0);
  });
});

describe("payouts", () => {
  it("pays only earned commission and does not pay it twice", async () => {
    const affiliate = await newAffiliate(0.1);

    const paidOrder = await orderVia(affiliate);
    await orderStore.setStatus(paidOrder.id, "paid");
    await orderVia(affiliate); // unpaid, must be excluded

    const first = await affiliateStore.payOut(affiliate.id);
    assert.equal(first.orders, 1, "an unpaid order was included in the payout");
    assert.equal(first.amount, 3.98);

    const second = await affiliateStore.payOut(affiliate.id);
    assert.equal(second.orders, 0, "the same commission was paid twice");
    assert.equal(second.amount, 0);

    const summary = await affiliateStore.summary(affiliate.code);
    assert.equal(summary?.commissionOwed, 0);
    assert.equal(summary?.commissionPaid, 3.98);
  });

  it("does not void commission that has already been paid out", async () => {
    const affiliate = await newAffiliate(0.1);
    const order = await orderVia(affiliate);
    await orderStore.setStatus(order.id, "paid");
    await affiliateStore.payOut(affiliate.id);

    // A settled order cannot be moved anyway, but the guard must hold even so:
    // money that has left the business is not reversed by a status change.
    await orderStore.setStatus(order.id, "cancelled");
    const reread = await orderStore.byReference(order.reference);
    assert.equal(reread?.commissionStatus, "paid", "paid-out commission was voided");
  });

  it("sums a payout across several orders", async () => {
    const affiliate = await newAffiliate(0.1);
    for (const subtotal of [39.8, 19.9, 59.7]) {
      const o = await orderVia(affiliate, { subtotal, total: subtotal + 8 });
      await orderStore.setStatus(o.id, "paid");
    }
    const result = await affiliateStore.payOut(affiliate.id);
    assert.equal(result.orders, 3);
    // 3.98 + 1.99 + 5.97
    assert.equal(result.amount, 11.94);
  });
});

describe("inactive affiliates", () => {
  it("is not resolvable by code once deactivated", async () => {
    const affiliate = await newAffiliate();
    assert.ok(await affiliateStore.activeByCode(affiliate.code));

    await affiliateStore.setActive(affiliate.id, false);
    assert.equal(
      await affiliateStore.activeByCode(affiliate.code),
      undefined,
      "a deactivated code still resolved for attribution",
    );
    // Still visible to the admin, so past earnings remain auditable.
    assert.ok(await affiliateStore.byCode(affiliate.code));
  });

  it("keeps commission already earned after deactivation", async () => {
    const affiliate = await newAffiliate(0.1);
    const order = await orderVia(affiliate);
    await orderStore.setStatus(order.id, "paid");
    await affiliateStore.setActive(affiliate.id, false);

    const summary = await affiliateStore.summary(affiliate.code);
    assert.equal(summary?.commissionOwed, 3.98, "deactivating an affiliate erased what they were owed");
  });

  it("ignores an unknown code entirely", async () => {
    assert.equal(await affiliateStore.activeByCode("NOSUCHCODE"), undefined);
    assert.equal(await affiliateStore.activeByCode("'; DROP TABLE affiliates; --"), undefined);
    // The table survived the attempt.
    assert.ok(Array.isArray(await affiliateStore.list()));
  });
});
