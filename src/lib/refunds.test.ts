/**
 * Refund tests.
 *
 * The failure being guarded against is paying out on money the shop gave back:
 * refunding a customer and still owing the affiliate a percentage of it, and
 * still owing the agent their fee.
 */

process.env.PGLITE_MEMORY = "1";
delete process.env.DATABASE_URL;
process.env.MAIL_DRIVER = "none";

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db/client";
import { affiliateStore, commissionFor, type Affiliate } from "@/lib/affiliates";
import { orderStore, type NewOrder } from "@/lib/orders";
import { earningsFor } from "@/lib/affiliate/sales";
import { commitReservation, markReserved, reserve, returnStock, setStock, stockLevels, availability } from "@/lib/stock";

let counter = 0;
const uniqueCode = () => `REF${(counter++).toString().padStart(4, "0")}`;

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

async function paidOrderVia(affiliate?: Affiliate, overrides: Partial<NewOrder> = {}) {
  const base = draft(overrides);
  const created = await orderStore.create({
    ...base,
    agentName: "KretivWork",
    agentFee: 2,
    ...(affiliate
      ? {
          affiliateId: affiliate.id,
          affiliateCode: affiliate.code,
          commissionRate: affiliate.commissionRate,
          commissionAmount: commissionFor(base.subtotal, affiliate.commissionRate),
        }
      : {}),
  });
  const paid = await orderStore.setStatus(created.id, "paid");
  assert.ok(paid);
  return paid;
}

const newAffiliate = () =>
  affiliateStore.create({
    code: uniqueCode(),
    name: "Refund Tester",
    email: "refund@example.com",
    commissionRate: 0.1,
  });

before(async () => {
  await getDb();
});

beforeEach(async () => {
  for (const level of await stockLevels()) {
    await setStock(level.productId, { tracked: false, onHand: 0 });
  }
  const db = await getDb();
  await db.query(`UPDATE product_stock SET reserved = 0`);
});

describe("recording a refund", () => {
  it("records the amount and the reason", async () => {
    const order = await paidOrderVia();
    const refunded = await orderStore.refund(order.id, "Jar arrived damaged");

    assert.ok(refunded);
    assert.equal(refunded.refundAmount, 47.8, "the whole total, delivery included");
    assert.equal(refunded.refundReason, "Jar arrived damaged");
    assert.ok(refunded.refundedAt);
  });

  it("leaves the payment status alone", async () => {
    const order = await paidOrderVia();
    const refunded = await orderStore.refund(order.id);
    // The order *was* paid. Rewriting the status to hide that would lose the
    // fact and break every query that counts a sale.
    assert.equal(refunded?.status, "paid");
  });

  it("refuses an order that was never paid", async () => {
    const order = await orderStore.create(draft());
    assert.equal(await orderStore.refund(order.id), undefined);
  });

  it("refuses a second refund", async () => {
    const order = await paidOrderVia();
    assert.ok(await orderStore.refund(order.id));
    // Two clicks must not refund twice, and must not void commission twice.
    assert.equal(await orderStore.refund(order.id), undefined);
  });

  it("refuses concurrent refunds of the same order", async () => {
    const order = await paidOrderVia();
    const results = await Promise.all(Array.from({ length: 4 }, () => orderStore.refund(order.id)));
    assert.equal(results.filter(Boolean).length, 1);
  });
});

describe("what a refund unwinds", () => {
  it("voids commission that had not been paid out", async () => {
    const affiliate = await newAffiliate();
    const order = await paidOrderVia(affiliate);

    assert.equal((await affiliateStore.summary(affiliate.code))?.commissionOwed, 3.98);

    await orderStore.refund(order.id);

    const summary = await affiliateStore.summary(affiliate.code);
    // The shop gave the money back; it does not also owe a percentage of it.
    assert.equal(summary?.commissionOwed, 0);
  });

  it("leaves commission that has already been paid out", async () => {
    const affiliate = await newAffiliate();
    const order = await paidOrderVia(affiliate);
    await affiliateStore.payOut(affiliate.id);

    await orderStore.refund(order.id);

    const summary = await affiliateStore.summary(affiliate.code);
    // That money has left the building. Pretending otherwise would make the
    // affiliate's figures disagree with what they were actually sent.
    assert.equal(summary?.commissionPaid, 3.98);
  });

  it("voids the agent fee that had not been paid out", async () => {
    const order = await paidOrderVia();
    assert.equal((await orderStore.stats()).agentFeesOwed >= 2, true);

    const before = (await orderStore.stats()).agentFeesOwed;
    await orderStore.refund(order.id);
    const after = (await orderStore.stats()).agentFeesOwed;

    assert.equal(round(before - after), 2, "the agent does not earn on a refunded sale");
  });

  it("takes the refund off revenue", async () => {
    const before = (await orderStore.stats()).revenue;
    const order = await paidOrderVia();
    const withSale = (await orderStore.stats()).revenue;
    assert.equal(round(withSale - before), 47.8);

    await orderStore.refund(order.id);
    const after = await orderStore.stats();

    assert.equal(round(after.revenue - before), 0, "money given back was never earned");
    assert.equal(after.refunded >= 47.8, true);
  });

  it("keeps the admin and the affiliate's own portal agreeing", async () => {
    const affiliate = await newAffiliate();
    const order = await paidOrderVia(affiliate);
    await orderStore.refund(order.id);

    const admin = await affiliateStore.summary(affiliate.code);
    const portal = await earningsFor(affiliate.id);

    // Two views of one relationship that disagree about how many sales
    // somebody made is worse than either figure being wrong on its own.
    assert.equal(admin?.orderCount, portal.paidOrders);
    assert.equal(admin?.salesSubtotal, portal.salesSubtotal);
    assert.equal(admin?.commissionOwed, portal.owed);
    assert.equal(portal.paidOrders, 0, "a refunded order is not a sale they earned on");
  });

  it("puts stock back on the shelf", async () => {
    await setStock("kabsah", { tracked: true, onHand: 10 });
    await reserve([{ productId: "kabsah", quantity: 2 }]);

    const order = await paidOrderVia();
    await markReserved(order.id);
    await commitReservation(order.id);
    assert.equal((await availability()).get("kabsah")!.onHand, 8);

    await orderStore.refund(order.id);
    assert.equal(await returnStock(order.id), true);

    const level = (await availability()).get("kabsah")!;
    assert.equal(level.onHand, 10);
    assert.equal(level.available, 10);
  });

  it("returns stock only once", async () => {
    await setStock("kabsah", { tracked: true, onHand: 10 });
    await reserve([{ productId: "kabsah", quantity: 2 }]);

    const order = await paidOrderVia();
    await markReserved(order.id);
    await commitReservation(order.id);
    await orderStore.refund(order.id);

    assert.equal(await returnStock(order.id), true);
    assert.equal(await returnStock(order.id), false);
    assert.equal((await availability()).get("kabsah")!.onHand, 10, "two jars back, not four");
  });

  it("does not return stock for an order that never sold any", async () => {
    const order = await paidOrderVia();
    await orderStore.refund(order.id);
    assert.equal(await returnStock(order.id), false);
  });
});

/** Two decimal places, the way money has to compare. */
function round(value: number) {
  return Math.round(value * 100) / 100;
}
