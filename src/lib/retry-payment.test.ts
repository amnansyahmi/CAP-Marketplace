/**
 * A payment that failed and then succeeded.
 *
 * The order page offers "try the payment again" on a failed order, and a
 * gateway can deliver a late `paid` after a `failed` regardless. Either way the
 * shop has already unwound the sale — stock back on the shelf, discount
 * redemption given back, commission and the agent fee voided — and now has to
 * put all of it back, because the sale turned out to be real.
 *
 * Getting this wrong is not cosmetic: the shop keeps counting jars it has
 * shipped, a limited promotion runs further than it was meant to, and the
 * affiliate who brought the customer is paid nothing.
 */

process.env.PGLITE_MEMORY = "1";
delete process.env.DATABASE_URL;
process.env.MAIL_DRIVER = "none";

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { affiliateStore } from "@/lib/affiliates";
import { getDb } from "@/lib/db/client";
import { discountStore } from "@/lib/discounts";
import { orderStore, type NewOrder } from "@/lib/orders";
import { commitReservation, markReserved, releaseReservation, reserve, setStock, stockLevels } from "@/lib/stock";

before(async () => {
  await getDb();
});

beforeEach(async () => {
  const db = await getDb();
  await db.query(`DELETE FROM order_items`);
  await db.query(`DELETE FROM orders`);
  await db.query(`DELETE FROM discount_codes`);
  await db.query(`DELETE FROM affiliates`);
  await db.query(`UPDATE product_stock SET on_hand = 0, reserved = 0, tracked = false`);
});

function draft(overrides: Partial<NewOrder> = {}): NewOrder {
  return {
    items: [{ productId: "kabsah", name: "Kabsah Paste", unitPrice: 19.9, quantity: 2, lineTotal: 39.8 }],
    customer: { fullName: "Cuba Semula", email: "retry@example.com", phone: "012-345 6789" },
    address: { line1: "1 Jalan Ujian", postcode: "55100", city: "Kuala Lumpur", state: "Kuala Lumpur" },
    subtotal: 39.8,
    shipping: 8,
    total: 47.8,
    currency: "MYR",
    ...overrides,
  };
}

/** Places an order the way `/api/orders` does: hold the stock, then record it. */
async function place(overrides: Partial<NewOrder> = {}) {
  const order = await orderStore.create(draft(overrides));
  await reserve(order.items.map((i) => ({ productId: i.productId, quantity: i.quantity })));
  await markReserved(order.id);
  return order;
}

/** What the callback handler does on a failure. */
async function fails(orderId: string) {
  await orderStore.setStatus(orderId, "failed");
  await releaseReservation(orderId);
  await discountStore.release(orderId);
}

/** What the callback handler does on a settled payment. */
async function settles(orderId: string) {
  const updated = await orderStore.setStatus(orderId, "paid");
  await commitReservation(orderId);
  await discountStore.reclaim(orderId);
  return updated;
}

const available = async (productId: string) =>
  (await stockLevels()).find((level) => level.productId === productId)?.available ?? null;

describe("stock, after a failed payment succeeds on the second try", () => {
  beforeEach(async () => {
    await setStock("kabsah", { tracked: true, onHand: 10 });
  });

  it("takes the jars off the shelf", async () => {
    const order = await place();
    assert.equal(await available("kabsah"), 8, "held while the customer pays");

    await fails(order.id);
    assert.equal(await available("kabsah"), 10, "given back when the payment fails");

    await settles(order.id);
    // The sale is real, so the jars are gone — without this the shop keeps
    // counting stock it has already shipped.
    assert.equal(await available("kabsah"), 8);
  });

  it("does not take them off twice when the callback is delivered again", async () => {
    const order = await place();
    await fails(order.id);
    await settles(order.id);
    await settles(order.id);
    assert.equal(await available("kabsah"), 8);
  });

  it("still lets a refund put them back", async () => {
    const order = await place();
    await fails(order.id);
    await settles(order.id);

    await orderStore.refund(order.id, "changed their mind");
    const { returnStock } = await import("@/lib/stock");
    assert.equal(await returnStock(order.id), true);
    assert.equal(await available("kabsah"), 10);
  });

  it("floors at zero and does not invent stock that was sold to someone else", async () => {
    const order = await place();
    await fails(order.id);

    // Everything sells out while the first customer is retrying.
    await setStock("kabsah", { tracked: true, onHand: 0 });

    await settles(order.id);
    assert.equal(await available("kabsah"), 0, "never negative");
  });
});

describe("a discount code, after a failed payment succeeds", () => {
  it("stays counted against its usage limit", async () => {
    await discountStore.create({ code: "RAYA10", kind: "percent", value: 0.1, maxRedemptions: 1 });
    const redeemed = await discountStore.redeem("RAYA10", 39.8);
    assert.equal(redeemed.ok, true);

    const order = await place({ discountCode: "RAYA10", discountAmount: 3.98 });

    await fails(order.id);
    assert.equal((await discountStore.byCode("RAYA10"))?.redeemed, 0, "given back on failure");

    await settles(order.id);
    // The customer used the code and paid. A one-use promotion that has been
    // used must not be available to the next person.
    assert.equal((await discountStore.byCode("RAYA10"))?.redeemed, 1);
  });

  it("does not double-count when the callback is delivered again", async () => {
    await discountStore.create({ code: "RAYA10", kind: "percent", value: 0.1, maxRedemptions: 5 });
    await discountStore.redeem("RAYA10", 39.8);
    const order = await place({ discountCode: "RAYA10", discountAmount: 3.98 });

    await fails(order.id);
    await settles(order.id);
    await settles(order.id);
    assert.equal((await discountStore.byCode("RAYA10"))?.redeemed, 1);
  });
});

describe("commission and the agent fee, after a failed payment succeeds", () => {
  it("are owed again, because the sale happened", async () => {
    const affiliate = await affiliateStore.create({
      code: "CHEFCLUB",
      name: "Chef Club",
      email: "club@example.com",
      commissionRate: 0.1,
    });

    const order = await place({
      affiliateId: affiliate.id,
      affiliateCode: affiliate.code,
      commissionRate: 0.1,
      commissionAmount: 3.98,
      agentName: "KretivWork",
      agentFee: 2,
    });

    await fails(order.id);
    const failed = await orderStore.byReference(order.reference);
    assert.equal(failed?.commissionStatus, "void");
    assert.equal(failed?.agentFeeStatus, "void");

    const settled = await settles(order.id);
    assert.equal(settled?.commissionStatus, "pending", "the affiliate is owed for a sale that went through");
    assert.equal(settled?.agentFeeStatus, "pending");
  });

  it("leaves commission voided by a refund alone", async () => {
    const affiliate = await affiliateStore.create({
      code: "CHEFCLUB",
      name: "Chef Club",
      email: "club@example.com",
      commissionRate: 0.1,
    });
    const order = await place({
      affiliateId: affiliate.id,
      affiliateCode: affiliate.code,
      commissionRate: 0.1,
      commissionAmount: 3.98,
      agentName: "KretivWork",
      agentFee: 2,
    });

    await settles(order.id);
    await orderStore.refund(order.id, "returned");

    // A duplicate 'paid' callback arriving after the refund must not resurrect
    // the commission — a refund voiding it is a different fact from a failed
    // payment voiding it.
    const again = await orderStore.setStatus(order.id, "paid");
    assert.equal(again?.commissionStatus, "void");
    assert.equal(again?.agentFeeStatus, "void");
  });
});
