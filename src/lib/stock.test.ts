/**
 * Stock tests.
 *
 * The failure these guard against is selling something twice: two customers
 * given an order number for one jar, and one of them getting an apology instead
 * of a delivery.
 */

process.env.PGLITE_MEMORY = "1";
delete process.env.DATABASE_URL;

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db/client";
import { orderStore, type NewOrder } from "@/lib/orders";
import {
  availability,
  commitReservation,
  markReserved,
  releaseReservation,
  reserve,
  setStock,
  stockLevels,
} from "@/lib/stock";

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

/** Places an order and marks it as holding its reservation, as the API does. */
async function placeOrder(items: NewOrder["items"]) {
  const order = await orderStore.create(draft({ items }));
  await markReserved(order.id);
  return order;
}

const levelOf = async (productId: string) => (await availability()).get(productId)!;

before(async () => {
  await getDb();
});

beforeEach(async () => {
  // Every product back to untracked with nothing on the shelf.
  for (const level of await stockLevels()) {
    await setStock(level.productId, { tracked: false, onHand: 0 });
  }
  const db = await getDb();
  await db.query(`UPDATE product_stock SET reserved = 0`);
});

describe("untracked products", () => {
  it("sell without a limit", async () => {
    const result = await reserve([{ productId: "kabsah", quantity: 9999 }]);
    // Turning this feature on must not take a shop offline that has never
    // counted its jars.
    assert.equal(result.ok, true);
  });

  it("report no availability figure", async () => {
    const level = await levelOf("kabsah");
    assert.equal(level.tracked, false);
  });
});

describe("reserving", () => {
  it("holds stock without taking it off the shelf", async () => {
    await setStock("kabsah", { tracked: true, onHand: 10 });
    assert.equal((await reserve([{ productId: "kabsah", quantity: 3 }])).ok, true);

    const level = await levelOf("kabsah");
    assert.equal(level.onHand, 10, "the jars are still physically there");
    assert.equal(level.reserved, 3);
    assert.equal(level.available, 7, "but nobody else can buy them");
  });

  it("refuses more than is available", async () => {
    await setStock("kabsah", { tracked: true, onHand: 2 });
    const result = await reserve([{ productId: "kabsah", quantity: 3 }]);

    assert.equal(result.ok, false);
    assert.deepEqual(result.ok === false && result.shortfalls, [
      { productId: "kabsah", wanted: 3, available: 2 },
    ]);
  });

  it("counts existing reservations against availability", async () => {
    await setStock("kabsah", { tracked: true, onHand: 3 });
    assert.equal((await reserve([{ productId: "kabsah", quantity: 3 }])).ok, true);

    // Someone still on the payment page is holding all three.
    const second = await reserve([{ productId: "kabsah", quantity: 1 }]);
    assert.equal(second.ok, false);
  });

  it("is all or nothing across lines", async () => {
    await setStock("kabsah", { tracked: true, onHand: 10 });
    await setStock("mandy", { tracked: true, onHand: 1 });

    const result = await reserve([
      { productId: "kabsah", quantity: 2 },
      { productId: "mandy", quantity: 5 },
    ]);
    assert.equal(result.ok, false);

    // A customer should not end up with half an order because one line ran out.
    assert.equal((await levelOf("kabsah")).reserved, 0, "the line that could be filled must not be held");
  });

  it("adds up repeated lines for the same product", async () => {
    await setStock("kabsah", { tracked: true, onHand: 3 });
    const result = await reserve([
      { productId: "kabsah", quantity: 2 },
      { productId: "kabsah", quantity: 2 },
    ]);
    // Four wanted, three available — checking each line alone would pass both.
    assert.equal(result.ok, false);
  });

  it("lets only one of several racing orders take the last jar", async () => {
    await setStock("kabsah", { tracked: true, onHand: 1 });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => reserve([{ productId: "kabsah", quantity: 1 }])),
    );

    assert.equal(results.filter((r) => r.ok).length, 1, "one jar, one winner");
    assert.equal((await levelOf("kabsah")).available, 0);
  });
});

describe("committing and releasing", () => {
  it("takes stock off the shelf when the order is paid", async () => {
    await setStock("kabsah", { tracked: true, onHand: 10 });
    await reserve([{ productId: "kabsah", quantity: 2 }]);
    const order = await placeOrder([
      { productId: "kabsah", name: "Kabsah Paste", unitPrice: 19.9, quantity: 2, lineTotal: 39.8 },
    ]);

    assert.equal(await commitReservation(order.id), true);

    const level = await levelOf("kabsah");
    assert.equal(level.onHand, 8);
    assert.equal(level.reserved, 0);
  });

  it("gives stock back when the order fails", async () => {
    await setStock("kabsah", { tracked: true, onHand: 10 });
    await reserve([{ productId: "kabsah", quantity: 2 }]);
    const order = await placeOrder([
      { productId: "kabsah", name: "Kabsah Paste", unitPrice: 19.9, quantity: 2, lineTotal: 39.8 },
    ]);

    assert.equal(await releaseReservation(order.id), true);

    const level = await levelOf("kabsah");
    assert.equal(level.onHand, 10, "nothing left the shelf");
    assert.equal(level.available, 10);
  });

  it("releases a reservation only once", async () => {
    await setStock("kabsah", { tracked: true, onHand: 10 });
    await reserve([{ productId: "kabsah", quantity: 4 }]);
    const order = await placeOrder([
      { productId: "kabsah", name: "Kabsah Paste", unitPrice: 19.9, quantity: 4, lineTotal: 79.6 },
    ]);

    assert.equal(await releaseReservation(order.id), true);
    // An order that failed and was then cancelled must not hand its jars back
    // twice and invent inventory the shop does not have.
    assert.equal(await releaseReservation(order.id), false);
    assert.equal((await levelOf("kabsah")).available, 10);
  });

  it("commits a reservation that was released, because the sale happened after all", async () => {
    // A payment fails, the jars go back on the shelf, and then the customer
    // retries and pays — or a late 'paid' callback lands after a 'failed' one.
    // The sale is real, so the stock has to come off; leaving it on the shelf
    // would have the shop counting jars it has already shipped.
    await setStock("kabsah", { tracked: true, onHand: 10 });
    await reserve([{ productId: "kabsah", quantity: 2 }]);
    const order = await placeOrder([
      { productId: "kabsah", name: "Kabsah Paste", unitPrice: 19.9, quantity: 2, lineTotal: 39.8 },
    ]);

    await releaseReservation(order.id);
    assert.equal((await levelOf("kabsah")).onHand, 10, "back on the shelf while the payment is failed");

    assert.equal(await commitReservation(order.id), true);
    assert.equal((await levelOf("kabsah")).onHand, 8);

    // And only once, however many times the callback is delivered.
    assert.equal(await commitReservation(order.id), false);
    assert.equal((await levelOf("kabsah")).onHand, 8);
  });

  it("commits only once for a webhook delivered twice", async () => {
    await setStock("kabsah", { tracked: true, onHand: 10 });
    await reserve([{ productId: "kabsah", quantity: 3 }]);
    const order = await placeOrder([
      { productId: "kabsah", name: "Kabsah Paste", unitPrice: 19.9, quantity: 3, lineTotal: 59.7 },
    ]);

    assert.equal(await commitReservation(order.id), true);
    assert.equal(await commitReservation(order.id), false);
    assert.equal((await levelOf("kabsah")).onHand, 7, "three jars sold, not six");
  });

  it("ignores an order that never held a reservation", async () => {
    const order = await orderStore.create(draft());
    assert.equal(await commitReservation(order.id), false);
    assert.equal(await releaseReservation(order.id), false);
  });
});

describe("editing stock in the admin", () => {
  it("never records a negative count", async () => {
    const level = await setStock("kabsah", { tracked: true, onHand: -50 });
    assert.equal(level?.onHand, 0);
  });

  it("leaves reservations alone when the count is corrected", async () => {
    await setStock("kabsah", { tracked: true, onHand: 10 });
    await reserve([{ productId: "kabsah", quantity: 4 }]);

    // Recounting the shelf must not release orders that are mid-payment.
    await setStock("kabsah", { tracked: true, onHand: 6 });
    const level = await levelOf("kabsah");
    assert.equal(level.reserved, 4);
    assert.equal(level.available, 2);
  });
});
