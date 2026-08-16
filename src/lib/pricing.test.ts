/**
 * Pricing tests.
 *
 * The thing that must hold: changing a price changes what the *next* customer
 * is charged and nothing else. An order already placed keeps the price it was
 * placed at, and a browser that thinks something is cheaper is simply wrong.
 */

process.env.PGLITE_MEMORY = "1";
delete process.env.DATABASE_URL;
process.env.MAIL_DRIVER = "none";

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db/client";
import { orderStore, type NewOrder } from "@/lib/orders";
import {
  MAX_PRICE,
  MIN_PRICE,
  clearPrice,
  priceMap,
  priceOverrides,
  priceProblem,
  pricedCatalogue,
  resetPricingCacheForTests,
  setPrice,
  startingPrice,
} from "@/lib/pricing";
import { productById, products } from "@/lib/products";

const KABSAH = productById("kabsah")!;

before(async () => {
  await getDb();
});

beforeEach(async () => {
  const db = await getDb();
  await db.query(`DELETE FROM product_prices`);
  resetPricingCacheForTests();
});

describe("what a product costs", () => {
  it("sells at the catalogue price until somebody changes it", async () => {
    const prices = await priceMap();
    for (const product of products) {
      assert.equal(prices.get(product.id), product.price);
    }
  });

  it("sells at the price the shop set", async () => {
    const saved = await setPrice("kabsah", 24.5);
    assert.equal(saved.ok, true);
    assert.deepEqual(saved.ok && saved.change, { productId: "kabsah", from: KABSAH.price, to: 24.5 });

    const prices = await priceMap();
    assert.equal(prices.get("kabsah"), 24.5);
    // Only the one that was changed.
    assert.equal(prices.get("mandy"), productById("mandy")!.price);
  });

  it("goes back to the catalogue price when the override is cleared", async () => {
    await setPrice("kabsah", 24.5);
    resetPricingCacheForTests();
    assert.equal(await clearPrice("kabsah"), true);
    assert.equal((await priceMap()).get("kabsah"), KABSAH.price);
  });

  it("reports which prices the shop set, and when", async () => {
    await setPrice("kabsah", 21);
    const overrides = await priceOverrides();
    assert.equal(overrides.get("kabsah")?.price, 21);
    assert.ok(Date.parse(overrides.get("kabsah")!.updatedAt) > 0);
    assert.equal(overrides.has("mandy"), false);
  });

  it("prices the catalogue and the 'from' figure with it", async () => {
    // 1.50 undercuts every catalogue price, so it must become the "from" price.
    await setPrice("mandy", 1.5);
    resetPricingCacheForTests();

    const catalogue = await pricedCatalogue();
    assert.equal(catalogue.find((p) => p.id === "mandy")?.price, 1.5);
    assert.equal(await startingPrice(), 1.5);
  });

  it("ignores a stored price for a product that is no longer sold", async () => {
    const db = await getDb();
    await db.query(`INSERT INTO product_prices (product_id, price) VALUES ('delisted', 5)`);
    resetPricingCacheForTests();

    const prices = await priceMap();
    assert.equal(prices.has("delisted"), false);
    assert.equal(prices.size, products.length);
  });
});

describe("refusing a price that is not one", () => {
  it("refuses zero, negative and absurd figures", () => {
    assert.ok(priceProblem(0));
    assert.ok(priceProblem(-5));
    assert.ok(priceProblem(Number.NaN));
    assert.ok(priceProblem(MAX_PRICE + 1));
    assert.ok(priceProblem(MIN_PRICE - 0.01));
  });

  it("refuses fractions of a sen", () => {
    // RM 19.999 is a typo, and rounding it silently would charge something
    // nobody chose.
    assert.ok(priceProblem(19.999));
    assert.equal(priceProblem(19.99), null);
  });

  it("does not write a refused price", async () => {
    const refused = await setPrice("kabsah", 0);
    assert.equal(refused.ok, false);
    assert.equal((await priceMap()).get("kabsah"), KABSAH.price);
  });

  it("refuses a product that is not in the catalogue", async () => {
    const refused = await setPrice("not-a-product", 20);
    assert.equal(refused.ok, false);
  });
});

describe("what a price change does not touch", () => {
  function draft(unitPrice: number): NewOrder {
    return {
      items: [
        { productId: "kabsah", name: KABSAH.name, unitPrice, quantity: 2, lineTotal: unitPrice * 2 },
      ],
      customer: { fullName: "Test Buyer", email: "buyer@example.com", phone: "012-345 6789" },
      address: { line1: "1 Jalan Ujian", postcode: "55100", city: "Kuala Lumpur", state: "Kuala Lumpur" },
      subtotal: unitPrice * 2,
      shipping: 8,
      total: unitPrice * 2 + 8,
      currency: "MYR",
    };
  }

  it("leaves an order at the price it was placed at", async () => {
    const placed = await orderStore.create(draft(KABSAH.price));
    const totalWhenPlaced = placed.total;

    await setPrice("kabsah", 49.9);
    resetPricingCacheForTests();

    const reread = await orderStore.byReference(placed.reference);
    assert.equal(reread?.items[0].unitPrice, KABSAH.price, "the sale keeps its own price");
    assert.equal(reread?.total, totalWhenPlaced, "and its own total");
  });
});
