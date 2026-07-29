/**
 * Discount code tests.
 *
 * Two things decide whether this costs the shop money it did not mean to spend:
 * whether a limited code can be over-redeemed, and whether commission is worked
 * out on what was actually collected.
 */

process.env.PGLITE_MEMORY = "1";
delete process.env.DATABASE_URL;

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { getDb } from "@/lib/db/client";
import { commissionFor } from "@/lib/affiliates";
import { discountFor, discountStore, normaliseDiscountCode } from "@/lib/discounts";
import { orderStore, type NewOrder } from "@/lib/orders";
import { round } from "@/lib/shipping";

let counter = 0;
const uniqueCode = (prefix = "SAVE") => `${prefix}${(counter++).toString().padStart(4, "0")}`;

before(async () => {
  await getDb();
});

describe("the arithmetic", () => {
  it("takes a percentage off the subtotal", () => {
    assert.equal(discountFor({ kind: "percent", value: 0.2 }, 100), 20);
  });

  it("rounds a half-sen the same way every other money figure does", () => {
    // 12.5% of RM 39.80 is 4.975 on paper. 39.8 has no exact binary
    // representation, so the product lands a hair below the midpoint and
    // rounds down to 4.97. That is one sen away from what a calculator says,
    // and it is deliberate: commission, shipping and totals all go through the
    // same `round`, and a discount that rounded differently would stop the
    // order's own figures adding up.
    assert.equal(discountFor({ kind: "percent", value: 0.125 }, 39.8), 4.97);
    assert.equal(round(39.8 * 0.125), 4.97);
  });

  it("takes a fixed amount off", () => {
    assert.equal(discountFor({ kind: "fixed", value: 15 }, 100), 15);
  });

  it("never gives back more than the bag is worth", () => {
    // RM 20 off a RM 12 bag makes it free, not a RM 8 payout to the customer.
    assert.equal(discountFor({ kind: "fixed", value: 20 }, 12), 12);
  });

  it("rejects anything that is not a code", () => {
    for (const raw of ["", " ", "AB", "a".repeat(30), "BAD CODE", "DROP TABLE", null, undefined]) {
      assert.equal(normaliseDiscountCode(raw), null);
    }
    assert.equal(normaliseDiscountCode(" raya20 "), "RAYA20");
  });
});

describe("validity", () => {
  it("accepts a live code", async () => {
    const code = uniqueCode();
    await discountStore.create({ code, kind: "percent", value: 0.1 });
    const result = await discountStore.check(code, 100);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.amount, 10);
  });

  it("refuses a code that has been turned off", async () => {
    const code = uniqueCode();
    const created = await discountStore.create({ code, kind: "percent", value: 0.1 });
    await discountStore.setActive(created.id, false);
    assert.equal((await discountStore.check(code, 100)).ok, false);
  });

  it("refuses an expired code", async () => {
    const code = uniqueCode();
    await discountStore.create({
      code,
      kind: "fixed",
      value: 5,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const result = await discountStore.check(code, 100);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /expired/i);
  });

  it("refuses a code that has not started", async () => {
    const code = uniqueCode();
    await discountStore.create({
      code,
      kind: "fixed",
      value: 5,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    assert.equal((await discountStore.check(code, 100)).ok, false);
  });

  it("enforces a minimum spend", async () => {
    const code = uniqueCode();
    await discountStore.create({ code, kind: "fixed", value: 10, minSubtotal: 80 });
    assert.equal((await discountStore.check(code, 50)).ok, false);
    assert.equal((await discountStore.check(code, 80)).ok, true);
  });

  it("says the same thing for an unknown code as a dead one", async () => {
    // Otherwise the checkout form becomes a way to discover which codes exist.
    const unknown = await discountStore.check("NOSUCHCODE", 100);
    const code = uniqueCode();
    const created = await discountStore.create({ code, kind: "fixed", value: 5 });
    await discountStore.setActive(created.id, false);
    const disabled = await discountStore.check(code, 100);

    assert.equal(unknown.ok, false);
    assert.equal(disabled.ok, false);
    assert.equal(
      unknown.ok === false ? unknown.reason : "",
      disabled.ok === false ? disabled.reason : "x",
    );
  });

  it("checking does not consume a use", async () => {
    const code = uniqueCode();
    await discountStore.create({ code, kind: "fixed", value: 5, maxRedemptions: 1 });
    // A customer looking at their total has not bought anything; burning the
    // code on a page view would let anyone empty a promotion for free.
    await discountStore.check(code, 100);
    await discountStore.check(code, 100);
    assert.equal((await discountStore.byCode(code))?.redeemed, 0);
  });
});

describe("redeeming", () => {
  it("counts a use", async () => {
    const code = uniqueCode();
    await discountStore.create({ code, kind: "fixed", value: 5 });
    assert.equal((await discountStore.redeem(code, 100)).ok, true);
    assert.equal((await discountStore.byCode(code))?.redeemed, 1);
  });

  it("stops at the usage limit", async () => {
    const code = uniqueCode();
    await discountStore.create({ code, kind: "fixed", value: 5, maxRedemptions: 2 });
    assert.equal((await discountStore.redeem(code, 100)).ok, true);
    assert.equal((await discountStore.redeem(code, 100)).ok, true);
    assert.equal((await discountStore.redeem(code, 100)).ok, false);
  });

  it("cannot be over-redeemed by simultaneous checkouts", async () => {
    const code = uniqueCode();
    await discountStore.create({ code, kind: "fixed", value: 5, maxRedemptions: 3 });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => discountStore.redeem(code, 100)),
    );

    assert.equal(results.filter((r) => r.ok).length, 3, "three uses, three winners");
    assert.equal((await discountStore.byCode(code))?.redeemed, 3);
  });

  it("gives a use back when the order never completes", async () => {
    const code = uniqueCode();
    await discountStore.create({ code, kind: "fixed", value: 5, maxRedemptions: 1 });
    await discountStore.redeem(code, 100);

    const order = await orderStore.create(orderDraft({ discountCode: code, discountAmount: 5 }));
    assert.equal(await discountStore.release(order.id), true);

    assert.equal((await discountStore.byCode(code))?.redeemed, 0);
    assert.equal((await discountStore.redeem(code, 100)).ok, true);
  });

  it("gives a use back only once", async () => {
    const code = uniqueCode();
    await discountStore.create({ code, kind: "fixed", value: 5, maxRedemptions: 2 });
    await discountStore.redeem(code, 100);
    await discountStore.redeem(code, 100);

    const order = await orderStore.create(orderDraft({ discountCode: code, discountAmount: 5 }));
    assert.equal(await discountStore.release(order.id), true);
    // A failed order that is then cancelled must not free up two uses.
    assert.equal(await discountStore.release(order.id), false);
    assert.equal((await discountStore.byCode(code))?.redeemed, 1);
  });

  it("ignores an order with no code on it", async () => {
    const order = await orderStore.create(orderDraft());
    assert.equal(await discountStore.release(order.id), false);
  });
});

describe("what a discount does to commission", () => {
  it("is earned on what the shop actually received", () => {
    const subtotal = 100;
    const discount = discountFor({ kind: "percent", value: 0.2 }, subtotal); // RM 20
    const discounted = round(subtotal - discount); // RM 80

    // The rule: 10% of the RM 80 collected, not of the RM 100 listed. Paying on
    // the pre-discount figure sends money out on revenue that never arrived —
    // the same error as paying commission on delivery.
    assert.equal(commissionFor(discounted, 0.1), 8);
    assert.notEqual(commissionFor(discounted, 0.1), commissionFor(subtotal, 0.1));
  });

  it("is recorded on the order alongside the code", async () => {
    const order = await orderStore.create(
      orderDraft({
        discountCode: "RAYA20",
        discountAmount: 8,
        subtotal: 39.8,
        total: 39.8 - 8 + 8,
      }),
    );
    const stored = await orderStore.byReference(order.reference);
    assert.equal(stored?.discountCode, "RAYA20");
    assert.equal(stored?.discountAmount, 8);
  });
});

function orderDraft(overrides: Partial<NewOrder> = {}): NewOrder {
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
