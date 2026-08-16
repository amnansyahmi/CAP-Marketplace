/**
 * Tests for the things that only matter when someone is trying, or when five
 * thousand people arrive at once.
 *
 * Three separate worries:
 *
 * 1. A payment that is authentic but for the wrong amount must not settle an
 *    order. Verifying the signature only proves who sent the message.
 * 2. A rate limit that lives in one process is not a limit when the load
 *    creates more processes, so the money endpoints count in the database.
 * 3. A courier API being slow or down must cost the shop one wait, not one per
 *    customer.
 */

process.env.PGLITE_MEMORY = "1";
delete process.env.DATABASE_URL;
process.env.MAIL_DRIVER = "none";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { deliveryOptions, resetDeliveryCacheForTests } from "@/lib/delivery";
import type { Order } from "@/lib/orders";
import { paymentMismatch } from "@/lib/payments/callbacks";
import type { CallbackReading } from "@/lib/payments/gateway";
import { sharedRateLimit } from "@/lib/rate-limit";

const env = process.env as Record<string, string | undefined>;

const order = { reference: "CA-7F3K9Q", total: 47.8, currency: "MYR" } as Order;

const reading = (extra: Partial<Extract<CallbackReading, { ok: true }>>) =>
  ({ ok: true, event: "status:3", status: "paid", ...extra }) as Extract<CallbackReading, { ok: true }>;

describe("checking what was actually paid", () => {
  it("accepts a payment for the order total", () => {
    assert.equal(paymentMismatch(order, reading({ paidAmount: 47.8, paidCurrency: "MYR" })), undefined);
  });

  it("refuses a payment for less than the order", () => {
    // The whole point: an authentic "paid" notice for RM 1 against an RM 47.80
    // order must not confirm it.
    const why = paymentMismatch(order, reading({ paidAmount: 1, paidCurrency: "MYR" }));
    assert.match(why ?? "", /paid 1\.00, order total is 47\.80/);
  });

  it("refuses a payment for more than the order too", () => {
    // Not generosity — a mismatch either way means the two records disagree,
    // and settling on a figure the shop cannot explain is how disputes start.
    assert.ok(paymentMismatch(order, reading({ paidAmount: 480, paidCurrency: "MYR" })));
  });

  it("refuses a payment in another currency", () => {
    const why = paymentMismatch(order, reading({ paidAmount: 47.8, paidCurrency: "USD" }));
    assert.match(why ?? "", /paid in USD/);
  });

  it("tolerates float representation, not a real difference", () => {
    assert.equal(paymentMismatch(order, reading({ paidAmount: 47.800000000000004 })), undefined);
    assert.ok(paymentMismatch(order, reading({ paidAmount: 47.7 })));
  });

  it("skips the check for a gateway that does not report an amount", () => {
    // Better than failing every payment on a field the shop cannot require.
    assert.equal(paymentMismatch(order, reading({})), undefined);
  });
});

describe("a rate limit that holds across instances", () => {
  const window = { limit: 3, windowMs: 60_000 };

  it("counts in the database, so a fresh instance does not start over", async () => {
    const key = `test:${Math.random()}`;
    // Each call is a separate "instance" as far as the shared counter cares —
    // nothing in this process is remembering anything.
    for (let i = 0; i < 3; i++) {
      assert.equal((await sharedRateLimit(key, window)).allowed, true, `call ${i + 1} should pass`);
    }

    const refused = await sharedRateLimit(key, window);
    assert.equal(refused.allowed, false);
    assert.ok(!refused.allowed && refused.retryInMs > 0);
  });

  it("keeps separate callers separate", async () => {
    const a = `test:${Math.random()}`;
    const b = `test:${Math.random()}`;
    for (let i = 0; i < 4; i++) await sharedRateLimit(a, window);
    assert.equal((await sharedRateLimit(b, window)).allowed, true);
  });

  it("lets the window expire", async () => {
    const key = `test:${Math.random()}`;
    const brief = { limit: 1, windowMs: 1 };
    assert.equal((await sharedRateLimit(key, brief)).allowed, true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal((await sharedRateLimit(key, brief)).allowed, true);
  });
});

describe("not letting the courier API decide whether the shop works", () => {
  const EASYPARCEL_KEYS = [
    "EASYPARCEL_API_KEY",
    "EASYPARCEL_PICKUP_POSTCODE",
    "EASYPARCEL_PICKUP_STATE",
  ] as const;

  const destination = { postcode: "10450", state: "Pulau Pinang" };
  const bag = [{ productId: "kabsah", quantity: 2 }];

  beforeEach(() => {
    for (const key of EASYPARCEL_KEYS) delete env[key];
    resetDeliveryCacheForTests();
  });

  process.on("exit", () => {
    for (const key of EASYPARCEL_KEYS) delete env[key];
  });

  function enableEasyParcel() {
    env.EASYPARCEL_API_KEY = "test-key";
    env.EASYPARCEL_PICKUP_POSTCODE = "55100";
    env.EASYPARCEL_PICKUP_STATE = "Kuala Lumpur";
  }

  /** Counts calls so "did we ask the courier again" is a fact, not a guess. */
  function stubFetch(handler: () => Response | Promise<Response>) {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return handler();
    }) as unknown as typeof fetch;
    return {
      get calls() {
        return calls;
      },
      restore: () => {
        globalThis.fetch = original;
      },
    };
  }

  const ratesResponse = () =>
    new Response(
      JSON.stringify({
        api_status: "Success",
        error_code: "0",
        result: [
          {
            rates: [
              { service_id: "EP-CS0A", courier_name: "J&T", service_name: "Standard", price: 6.5, delivery: "2 days" },
            ],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  it("asks the courier once for the same bag and destination", async () => {
    enableEasyParcel();
    const stub = stubFetch(ratesResponse);
    try {
      const first = await deliveryOptions(bag, destination, 39.8);
      const second = await deliveryOptions(bag, destination, 39.8);

      assert.equal(stub.calls, 1, "the second identical quote should come from cache");
      assert.equal(first?.source, "easyparcel");
      assert.equal(second?.options[0]?.courierName, "J&T");
    } finally {
      stub.restore();
    }
  });

  it("stops asking after repeated failures, and still quotes a price", async () => {
    enableEasyParcel();
    const stub = stubFetch(() => {
      throw new Error("courier API unreachable");
    });
    try {
      // Different destinations, so the cache cannot be what stops the calls.
      const postcodes = ["10450", "40000", "80000", "93000", "88000"];
      const quotes = [];
      for (const postcode of postcodes) {
        quotes.push(await deliveryOptions(bag, { postcode, state: "Pulau Pinang" }, 39.8));
      }

      assert.equal(stub.calls, 3, "the breaker should open after three failures in a row");
      // Every customer still got a working checkout on the shop's flat rate.
      for (const quote of quotes) {
        assert.equal(quote?.source, "flat");
        assert.equal(quote?.options.length, 1);
        assert.ok((quote?.options[0]?.price ?? -1) >= 0);
      }
    } finally {
      stub.restore();
    }
  });

  it("does not touch the courier at all when it is not configured", async () => {
    const stub = stubFetch(ratesResponse);
    try {
      const quote = await deliveryOptions(bag, destination, 39.8);
      assert.equal(stub.calls, 0);
      assert.equal(quote?.source, "flat");
    } finally {
      stub.restore();
    }
  });
});
