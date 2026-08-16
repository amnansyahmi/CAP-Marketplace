/**
 * Bayarcash integration tests.
 *
 * Two things here decide whether money is real: the checksum on the request,
 * which is what stops an amount being edited on the way to the gateway, and the
 * checksum on the callback, which is the only reason a "paid" notice can be
 * believed. Both are pinned to vectors computed the way the official PHP SDK
 * computes them — fields sorted by name, joined with `|`, HMAC-SHA256.
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { beforeEach, describe, it } from "node:test";

import type { Order } from "@/lib/orders";
import {
  bayarcashChecksum,
  bayarcashConfig,
  bayarcashGateway,
  createPurchase,
  formatAmount,
  normalisePhone,
  parseCallbackBody,
  statusFromCode,
  verifyCallback,
} from "@/lib/payments/bayarcash";

const env = process.env as Record<string, string | undefined>;
const KEYS = [
  "BAYARCASH_PAT",
  "BAYARCASH_PORTAL_KEY",
  "BAYARCASH_API_SECRET_KEY",
  "BAYARCASH_SANDBOX",
  "BAYARCASH_API_URL",
  "BAYARCASH_PAYMENT_CHANNEL",
] as const;
const saved: Record<string, string | undefined> = {};

const SECRET = "test-secret-key";

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = env[key];
    delete env[key];
  }
});

process.on("exit", () => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
});

/** A complete, well-formed transaction callback for the given status. */
function transactionCallback(status: string, overrides: Record<string, string> = {}) {
  const data: Record<string, string> = {
    record_type: "Transaction",
    transaction_id: "TRX123456",
    exchange_reference_number: "EXR987654",
    exchange_transaction_id: "EXT456789",
    order_number: "CA-7F3K9Q",
    currency: "MYR",
    amount: "47.80",
    payer_name: "Test Buyer",
    payer_email: "buyer@example.com",
    payer_bank_name: "Maybank2u",
    status,
    status_description: "Approved",
    datetime: "2026-08-16 10:30:00",
    ...overrides,
  };
  // Signed over exactly the fields above, so the vector is built the same way
  // the gateway would build it rather than by calling the code under test.
  const payload = Object.keys(data)
    .sort()
    .map((key) => data[key])
    .join("|");
  data.checksum = createHmac("sha256", SECRET).update(payload, "utf8").digest("hex");
  return data;
}

describe("checksum", () => {
  it("sorts fields by name and joins them with a pipe", () => {
    // amount | order_number | payer_email | payer_name | payment_channel
    const expected = createHmac("sha256", SECRET)
      .update("10.00|INV-1001|ahmad@example.com|Ahmad bin Abdullah|1", "utf8")
      .digest("hex");

    assert.equal(
      bayarcashChecksum(SECRET, {
        payment_channel: "1",
        order_number: "INV-1001",
        amount: "10.00",
        payer_name: "Ahmad bin Abdullah",
        payer_email: "ahmad@example.com",
      }),
      expected,
    );
  });

  it("does not depend on the order the fields are listed in", () => {
    const a = bayarcashChecksum(SECRET, { b: "two", a: "one", c: "three" });
    const b = bayarcashChecksum(SECRET, { c: "three", a: "one", b: "two" });
    assert.equal(a, b);
  });

  it("keeps an empty channel as an empty field rather than dropping it", () => {
    const expected = createHmac("sha256", SECRET)
      .update("10.00|INV-1001|ahmad@example.com|Ahmad bin Abdullah|", "utf8")
      .digest("hex");

    assert.equal(
      bayarcashChecksum(SECRET, {
        payment_channel: "",
        order_number: "INV-1001",
        amount: "10.00",
        payer_name: "Ahmad bin Abdullah",
        payer_email: "ahmad@example.com",
      }),
      expected,
    );
  });
});

describe("verifying a callback", () => {
  it("accepts an authentic transaction callback", () => {
    env.BAYARCASH_API_SECRET_KEY = SECRET;
    assert.equal(verifyCallback(transactionCallback("3"), "transaction"), true);
  });

  it("rejects one whose amount was edited in transit", () => {
    env.BAYARCASH_API_SECRET_KEY = SECRET;
    const tampered = { ...transactionCallback("3"), amount: "0.10" };
    assert.equal(verifyCallback(tampered, "transaction"), false);
  });

  it("rejects one signed with a different key", () => {
    env.BAYARCASH_API_SECRET_KEY = "another-secret";
    assert.equal(verifyCallback(transactionCallback("3"), "transaction"), false);
  });

  it("rejects everything when no secret key is configured", () => {
    // A missing key must never mean "assume it is genuine": without it there is
    // no way to tell an authentic callback from a forged one.
    assert.equal(verifyCallback(transactionCallback("3"), "transaction"), false);
  });

  it("rejects a callback with no checksum at all", () => {
    env.BAYARCASH_API_SECRET_KEY = SECRET;
    const { checksum: _dropped, ...unsigned } = transactionCallback("3");
    assert.equal(verifyCallback(unsigned, "transaction"), false);
  });

  it("does not accept a transaction callback as a return redirect", () => {
    // The two sign different field sets, so a checksum proves authenticity only
    // for the set it was computed over.
    env.BAYARCASH_API_SECRET_KEY = SECRET;
    assert.equal(verifyCallback(transactionCallback("3"), "return"), false);
  });
});

describe("status codes", () => {
  it("maps the terminal codes onto order statuses", () => {
    assert.equal(statusFromCode("3"), "paid");
    assert.equal(statusFromCode("2"), "failed");
    assert.equal(statusFromCode("4"), "cancelled");
  });

  it("leaves an in-flight payment alone", () => {
    // 0 (new) and 1 (pending) say nothing has been decided yet, and the order
    // is already pending_payment.
    assert.equal(statusFromCode("0"), undefined);
    assert.equal(statusFromCode("1"), undefined);
    assert.equal(statusFromCode(undefined), undefined);
    assert.equal(statusFromCode("99"), undefined);
  });
});

describe("parsing a callback body", () => {
  it("reads the form-encoded body Bayarcash posts", () => {
    const body = "order_number=CA-7F3K9Q&status=3&amount=47.80";
    const data = parseCallbackBody(body, new Headers({ "content-type": "application/x-www-form-urlencoded" }));
    assert.deepEqual(data, { order_number: "CA-7F3K9Q", status: "3", amount: "47.80" });
  });

  it("reads a JSON body too, with every value as a string", () => {
    const data = parseCallbackBody(
      JSON.stringify({ order_number: "CA-7F3K9Q", status: 3 }),
      new Headers({ "content-type": "application/json" }),
    );
    assert.deepEqual(data, { order_number: "CA-7F3K9Q", status: "3" });
  });

  it("returns nothing for an empty or malformed body", () => {
    assert.equal(parseCallbackBody("", new Headers()), null);
    assert.equal(parseCallbackBody("{oops", new Headers({ "content-type": "application/json" })), null);
  });
});

describe("payer details", () => {
  it("puts a Malaysian mobile number into the form the gateway wants", () => {
    assert.equal(normalisePhone("012-345 6789"), "60123456789");
    assert.equal(normalisePhone("0123456789"), "60123456789");
    assert.equal(normalisePhone("+60 12 345 6789"), "60123456789");
    assert.equal(normalisePhone(""), "");
  });

  it("sends the total as a decimal string, not sen", () => {
    assert.equal(formatAmount(47.8), "47.80");
    assert.equal(formatAmount(1234), "1234.00");
  });
});

describe("creating a payment intent", () => {
  const order = {
    id: "11111111-2222-3333-4444-555555555555",
    reference: "CA-7F3K9Q",
    total: 47.8,
    currency: "MYR",
    customer: { fullName: "Test Buyer", email: "buyer@example.com", phone: "012-345 6789" },
  } as unknown as Order;

  const urls = {
    returnUrl: "https://shop.my/api/payments/bayarcash/return?reference=CA-7F3K9Q&t=tok",
    successUrl: "https://shop.my/orders/CA-7F3K9Q?t=tok",
    failureUrl: "https://shop.my/orders/CA-7F3K9Q?t=tok&payment=failed",
    callbackUrl: "https://shop.my/api/webhooks/bayarcash",
  };

  /** Captures the outgoing request instead of contacting Bayarcash. */
  function stubFetch(response: unknown, status = 200) {
    const calls: { url: string; init: RequestInit }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(response), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return {
      calls,
      restore: () => {
        globalThis.fetch = original;
      },
    };
  }

  function sentFields(init: RequestInit) {
    return Object.fromEntries(new URLSearchParams(String(init.body)));
  }

  it("sends the order total as one signed decimal amount", async () => {
    env.BAYARCASH_PAT = "token";
    env.BAYARCASH_PORTAL_KEY = "portal-key";
    env.BAYARCASH_API_SECRET_KEY = SECRET;
    const stub = stubFetch({ id: "intent_123", url: "https://gateway.example/pay/intent_123" });

    try {
      const result = await createPurchase(order, urls);
      const fields = sentFields(stub.calls[0].init);

      assert.equal(stub.calls[0].url, "https://api.console.bayar.cash/v3/payment-intents");
      assert.equal(fields.portal_key, "portal-key");
      assert.equal(fields.order_number, "CA-7F3K9Q");
      assert.equal(fields.amount, "47.80");
      assert.equal(fields.payer_telephone_number, "60123456789");
      assert.equal(fields.callback_url, urls.callbackUrl);
      // The payer comes back to our own verifying route, not straight to the
      // order page: the redirect's claim has to be checked first.
      assert.equal(fields.return_url, urls.returnUrl);
      // No channel configured, so the payer picks one on Bayarcash's page —
      // but the checksum still counts it as an empty field.
      assert.equal(fields.payment_channel, undefined);
      assert.equal(
        fields.checksum,
        bayarcashChecksum(SECRET, {
          payment_channel: "",
          order_number: "CA-7F3K9Q",
          amount: "47.80",
          payer_name: "Test Buyer",
          payer_email: "buyer@example.com",
        }),
      );
      assert.deepEqual(result, {
        paymentId: "intent_123",
        checkoutUrl: "https://gateway.example/pay/intent_123",
        live: true,
      });
    } finally {
      stub.restore();
    }
  });

  it("signs the configured channel when one is set", async () => {
    env.BAYARCASH_PAT = "token";
    env.BAYARCASH_PORTAL_KEY = "portal-key";
    env.BAYARCASH_API_SECRET_KEY = SECRET;
    env.BAYARCASH_PAYMENT_CHANNEL = "1";
    const stub = stubFetch({ id: "intent_123", url: "https://gateway.example/pay/intent_123" });

    try {
      await createPurchase(order, urls);
      const fields = sentFields(stub.calls[0].init);
      assert.equal(fields.payment_channel, "1");
      assert.equal(
        fields.checksum,
        bayarcashChecksum(SECRET, {
          payment_channel: "1",
          order_number: "CA-7F3K9Q",
          amount: "47.80",
          payer_name: "Test Buyer",
          payer_email: "buyer@example.com",
        }),
      );
    } finally {
      stub.restore();
    }
  });

  it("fails loudly when the gateway rejects the request", async () => {
    env.BAYARCASH_PAT = "token";
    env.BAYARCASH_PORTAL_KEY = "portal-key";
    const stub = stubFetch({ message: "Invalid portal key" }, 422);

    try {
      // The order route turns this into a released stock hold and a 502, which
      // is only correct if the failure actually surfaces.
      await assert.rejects(() => createPurchase(order, urls), /Bayarcash payment intent failed \(422\)/);
    } finally {
      stub.restore();
    }
  });

  it("refuses to simulate a payment on a production deployment", async () => {
    // No credentials. On a laptop this is the demo path; on a real deployment
    // it would mean telling a customer their unpaid order was confirmed.
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      await assert.rejects(() => createPurchase(order, urls), /Refusing to simulate a payment/);
    } finally {
      if (previous === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = previous;
    }
  });
});

describe("reading a callback", () => {
  const form = new Headers({ "content-type": "application/x-www-form-urlencoded" });

  function body(data: Record<string, string>) {
    return new URLSearchParams(data).toString();
  }

  it("reports a settled payment against the order it names", () => {
    env.BAYARCASH_API_SECRET_KEY = SECRET;
    const reading = bayarcashGateway.readCallback(body(transactionCallback("3")), form);
    assert.deepEqual(reading, { ok: true, event: "status:3", status: "paid", reference: "CA-7F3K9Q" });
  });

  it("carries no status while the payment is still in flight", () => {
    env.BAYARCASH_API_SECRET_KEY = SECRET;
    const reading = bayarcashGateway.readCallback(body(transactionCallback("1")), form);
    assert.deepEqual(reading, { ok: true, event: "status:1", reference: "CA-7F3K9Q" });
  });

  it("refuses a forged callback", () => {
    env.BAYARCASH_API_SECRET_KEY = SECRET;
    const forged = { ...transactionCallback("3"), checksum: "0".repeat(64) };
    assert.deepEqual(bayarcashGateway.readCallback(body(forged), form), { ok: false, reason: "unverified" });
  });

  it("acknowledges an authentic pre-transaction notice without touching the order", () => {
    env.BAYARCASH_API_SECRET_KEY = SECRET;
    const data: Record<string, string> = {
      record_type: "Pre-Transaction",
      exchange_reference_number: "EXR987654",
      order_number: "CA-7F3K9Q",
    };
    data.checksum = bayarcashChecksum(SECRET, data);
    const reading = bayarcashGateway.readCallback(body(data), form);
    assert.deepEqual(reading, { ok: true, event: "pre-transaction", reference: "CA-7F3K9Q" });
  });

  it("calls an empty body malformed rather than unverified", () => {
    env.BAYARCASH_API_SECRET_KEY = SECRET;
    assert.deepEqual(bayarcashGateway.readCallback("", form), { ok: false, reason: "malformed" });
  });
});

describe("configuration", () => {
  it("is not live until both the token and the portal key are set", () => {
    assert.equal(bayarcashConfig().isLive, false);
    env.BAYARCASH_PAT = "token";
    assert.equal(bayarcashConfig().isLive, false);
    env.BAYARCASH_PORTAL_KEY = "portal";
    assert.equal(bayarcashConfig().isLive, true);
  });

  it("uses the sandbox console only when asked", () => {
    assert.equal(bayarcashConfig().apiUrl, "https://api.console.bayar.cash/v3");
    env.BAYARCASH_SANDBOX = "1";
    assert.equal(bayarcashConfig().apiUrl, "https://api.console.bayarcash-sandbox.com/v3");
  });
});
