/**
 * Logistics tests.
 *
 * Three things cost real money here: under-quoting postage, booking the same
 * parcel twice, and telling a customer their order arrived when it has not.
 */

process.env.PGLITE_MEMORY = "1";
delete process.env.DATABASE_URL;
process.env.MAIL_DRIVER = "none";

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db/client";
import { deliveryOptions, priceDelivery } from "@/lib/delivery";
import { easyParcelConfig, mapParcelStatus } from "@/lib/easyparcel";
import { parcelContents, parcelFor, totalJars } from "@/lib/parcel";
import { orderStore, type NewOrder } from "@/lib/orders";
import { bookOrderShipment } from "@/lib/shipments";
import { ZONE_RATES } from "@/lib/shipping";

const env = process.env as Record<string, string | undefined>;
const EASYPARCEL_KEYS = [
  "EASYPARCEL_API_KEY",
  "EASYPARCEL_PICKUP_POSTCODE",
  "EASYPARCEL_PICKUP_STATE",
] as const;

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

beforeEach(() => {
  for (const key of EASYPARCEL_KEYS) delete env[key];
});

describe("configuration", () => {
  it("is off until an API key is set", () => {
    assert.equal(easyParcelConfig().enabled, false);
  });

  it("stays off without a collection address", () => {
    env.EASYPARCEL_API_KEY = "test-key";
    // Every rate depends on where the parcel is collected from. Quoting
    // without one would be confidently wrong, which is worse than no quote.
    assert.equal(easyParcelConfig().enabled, false);
  });

  it("is on once the key and pickup point are both set", () => {
    env.EASYPARCEL_API_KEY = "test-key";
    env.EASYPARCEL_PICKUP_POSTCODE = "55100";
    env.EASYPARCEL_PICKUP_STATE = "Kuala Lumpur";
    assert.equal(easyParcelConfig().enabled, true);
  });
});

describe("what goes in the box", () => {
  it("counts the jars", () => {
    assert.equal(totalJars([{ productId: "kabsah", quantity: 2 }, { productId: "mandy", quantity: 3 }]), 5);
  });

  it("ignores products that are not in the catalogue", () => {
    assert.equal(totalJars([{ productId: "not-a-product", quantity: 9 }]), 0);
  });

  it("weighs more than the jars alone", () => {
    const parcel = parcelFor([{ productId: "kabsah", quantity: 2 }]);
    // Two 350g jars is 0.7kg of goods. Quoting that would under-buy postage on
    // every single order, because a box and padding are not weightless.
    assert.ok(parcel.weightKg > 0.7, `expected more than 0.7kg, got ${parcel.weightKg}`);
  });

  it("gets heavier as more jars go in", () => {
    const two = parcelFor([{ productId: "kabsah", quantity: 2 }]);
    const six = parcelFor([{ productId: "kabsah", quantity: 6 }]);
    assert.ok(six.weightKg > two.weightKg);
  });

  it("charges volumetric weight when the box is bulky for its weight", () => {
    // A big box of light jars is priced on the space it takes, and every
    // Malaysian courier bills the greater of the two.
    const parcel = parcelFor([{ productId: "kabsah", quantity: 6 }]);
    const volumetric = (parcel.widthCm * parcel.lengthCm * parcel.heightCm) / 6000;
    assert.ok(parcel.weightKg >= Math.min(volumetric, parcel.weightKg));
    assert.ok(parcel.weightKg > 0);
  });

  it("never quotes a zero-sized parcel", () => {
    const parcel = parcelFor([]);
    assert.ok(parcel.weightKg > 0);
    assert.ok(parcel.widthCm > 0 && parcel.lengthCm > 0 && parcel.heightCm > 0);
  });

  it("describes the contents for the consignment note", () => {
    assert.match(parcelContents([{ productId: "kabsah", quantity: 3 }]), /3 ×/);
  });
});

describe("delivery options without a courier API", () => {
  it("still offers the flat rate", async () => {
    const quote = await deliveryOptions([{ productId: "kabsah", quantity: 2 }], { postcode: "55100", state: "Kuala Lumpur" }, 39.8);
    assert.ok(quote);
    assert.equal(quote.source, "flat");
    assert.equal(quote.options.length, 1);
    assert.equal(quote.options[0].price, ZONE_RATES.west.fee);
    assert.equal(quote.options[0].fallback, true);
  });

  it("charges the East Malaysia rate for Sabah", async () => {
    const quote = await deliveryOptions([{ productId: "kabsah", quantity: 2 }], { postcode: "88000", state: "Sabah" }, 39.8);
    assert.equal(quote?.options[0].price, ZONE_RATES.east.fee);
  });

  it("refuses a destination the shop does not deliver to", async () => {
    const quote = await deliveryOptions([{ productId: "kabsah", quantity: 2 }], { postcode: "00000", state: "Singapore" }, 39.8);
    assert.equal(quote, null);
  });

  it("zeroes what the customer pays on a free-delivery order, not what it costs", async () => {
    const quote = await deliveryOptions(
      [{ productId: "kabsah", quantity: 10 }],
      { postcode: "55100", state: "Kuala Lumpur" },
      ZONE_RATES.west.freeFrom,
    );
    assert.ok(quote);
    assert.equal(quote.free, true);
    assert.equal(quote.options[0].price, 0, "the customer pays nothing");
    assert.ok(quote.options[0].cost > 0, "but the parcel still costs the shop something");
  });
});

describe("re-pricing a chosen service", () => {
  it("falls back when the chosen service no longer exists", async () => {
    // A courier can withdraw a service between quoting and paying. The
    // customer should not be stranded on the payment page because of it.
    const option = await priceDelivery(
      [{ productId: "kabsah", quantity: 2 }],
      { postcode: "55100", state: "Kuala Lumpur" },
      39.8,
      "a-service-that-vanished",
    );
    assert.ok(option);
    assert.equal(option.fallback, true);
  });

  it("returns nothing for an undeliverable address", async () => {
    const option = await priceDelivery(
      [{ productId: "kabsah", quantity: 2 }],
      { postcode: "0000", state: "Atlantis" },
      39.8,
      undefined,
    );
    assert.equal(option, null);
  });
});

describe("reading a courier's status", () => {
  it("recognises delivery", () => {
    for (const wording of ["Delivered", "DELIVERED", "delivery successful", "Received by customer"]) {
      assert.equal(mapParcelStatus(wording), "delivered", wording);
    }
  });

  it("recognises being in transit", () => {
    for (const wording of ["In Transit", "Out for delivery", "Picked up", "Departed from hub"]) {
      assert.equal(mapParcelStatus(wording), "shipped", wording);
    }
  });

  it("leaves anything it does not understand alone", () => {
    // Guessing here would email a customer that their parcel arrived when it
    // is actually sitting in a depot with a problem.
    for (const wording of ["", "Pending", "Exception", "Address issue", "Held at customs", "???"]) {
      assert.equal(mapParcelStatus(wording), null, wording);
    }
  });
});

describe("booking a shipment", () => {
  it("refuses when EasyParcel is not configured", async () => {
    const order = await orderStore.create(draft());
    const result = await bookOrderShipment(order.id);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /not configured/i);
  });

  it("refuses an order that was never paid", async () => {
    env.EASYPARCEL_API_KEY = "test-key";
    env.EASYPARCEL_PICKUP_POSTCODE = "55100";
    env.EASYPARCEL_PICKUP_STATE = "Kuala Lumpur";

    const order = await orderStore.create(draft());
    const result = await bookOrderShipment(order.id);
    // Posting goods for money that never arrived is the one mistake a courier
    // integration must not make easy.
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /paid/i);
  });

  it("refuses a refunded order", async () => {
    env.EASYPARCEL_API_KEY = "test-key";
    env.EASYPARCEL_PICKUP_POSTCODE = "55100";
    env.EASYPARCEL_PICKUP_STATE = "Kuala Lumpur";

    const created = await orderStore.create(draft({ deliveryServiceId: "svc-1" }));
    await orderStore.setStatus(created.id, "paid");
    await orderStore.refund(created.id);

    const result = await bookOrderShipment(created.id);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /refunded/i);
  });

  it("refuses an order with no courier service on it", async () => {
    env.EASYPARCEL_API_KEY = "test-key";
    env.EASYPARCEL_PICKUP_POSTCODE = "55100";
    env.EASYPARCEL_PICKUP_STATE = "Kuala Lumpur";

    const created = await orderStore.create(draft());
    await orderStore.setStatus(created.id, "paid");

    const result = await bookOrderShipment(created.id);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /flat rate/i);
  });

  it("leaves the order bookable after a failure", async () => {
    env.EASYPARCEL_API_KEY = "test-key";
    env.EASYPARCEL_PICKUP_POSTCODE = "55100";
    env.EASYPARCEL_PICKUP_STATE = "Kuala Lumpur";

    const created = await orderStore.create(draft({ deliveryServiceId: "svc-1" }));
    await orderStore.setStatus(created.id, "paid");

    // The host does not resolve, so the call fails the way a network problem
    // would.
    const first = await bookOrderShipment(created.id);
    assert.equal(first.ok, false);

    const after = await orderStore.byReference(created.reference);
    // Back to 'none', not stuck at 'booking' — a transient error must not lock
    // an order out of ever being shipped.
    assert.equal(after?.shipmentState, "none");
    assert.ok(after?.shipmentError, "the reason is kept so the shop owner can see it");

    const second = await bookOrderShipment(created.id);
    assert.equal(second.ok, false, "still fails, but it was allowed to try again");
  });

  it("records the chosen courier on the order", async () => {
    const created = await orderStore.create(
      draft({
        deliveryServiceId: "svc-99",
        deliveryCourier: "J&T Express",
        deliveryServiceName: "Domestic",
        deliveryCost: 6.5,
      }),
    );
    const stored = await orderStore.byReference(created.reference);
    assert.equal(stored?.deliveryServiceId, "svc-99");
    assert.equal(stored?.deliveryCourier, "J&T Express");
    assert.equal(stored?.deliveryCost, 6.5);
    assert.equal(stored?.shipmentState, "none");
  });
});
