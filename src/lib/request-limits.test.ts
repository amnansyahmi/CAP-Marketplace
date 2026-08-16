/**
 * Bounds on an unauthenticated request.
 *
 * The cases here are the ones a browser cannot produce and a script can: a bag
 * with thousands of lines, the same product repeated to multiply a per-line
 * cap, and a body large enough that parsing it is the attack.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateCheckout, type CheckoutInput } from "@/lib/checkout-schema";
import {
  MAX_BODY_BYTES,
  MAX_ITEM_LINES,
  MAX_UNITS_PER_ORDER,
  normaliseBagLines,
  readJsonBody,
} from "@/lib/request-limits";

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("https://shop.my/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

const validCheckout = (items: CheckoutInput["items"]): Partial<CheckoutInput> => ({
  fullName: "Test Buyer",
  email: "buyer@example.com",
  phone: "012-345 6789",
  line1: "1 Jalan Ujian",
  postcode: "55100",
  city: "Kuala Lumpur",
  state: "Kuala Lumpur",
  items,
});

describe("reading a bounded body", () => {
  it("reads an ordinary body", async () => {
    const read = await readJsonBody<{ hello: string }>(request(JSON.stringify({ hello: "world" })));
    assert.equal(read.ok, true);
    assert.deepEqual(read.ok && read.body, { hello: "world" });
  });

  it("refuses one that declares itself oversized, without reading it", async () => {
    // The header alone is enough to say no — nothing is parsed.
    const read = await readJsonBody(request("{}", { "content-length": String(MAX_BODY_BYTES + 1) }));
    assert.equal(read.ok, false);
    assert.equal(!read.ok && read.response.status, 413);
  });

  it("refuses one that is oversized despite what it declared", async () => {
    // No content-length to trust: the decoded body is measured itself.
    const huge = JSON.stringify({ padding: "x".repeat(MAX_BODY_BYTES) });
    const read = await readJsonBody(request(huge));
    assert.equal(read.ok, false);
    assert.equal(!read.ok && read.response.status, 413);
  });

  it("answers malformed JSON with a 400, not a crash", async () => {
    const read = await readJsonBody(request("{not json"));
    assert.equal(read.ok, false);
    assert.equal(!read.ok && read.response.status, 400);
  });
});

describe("bounding a bag", () => {
  it("merges a product repeated to get round the per-line cap", () => {
    // 50 lines x 99 would be 4,950 jars through a control that looks like it
    // stops at 99.
    const lines = Array.from({ length: 50 }, () => ({ productId: "kabsah", quantity: 99 }));
    const bag = normaliseBagLines(lines);
    assert.equal(bag.length, 1);
    assert.equal(bag[0].quantity, 99);
  });

  it("never lets one bag exceed the order-wide cap", () => {
    const lines = [
      { productId: "kabsah", quantity: 99 },
      { productId: "mandy", quantity: 99 },
      { productId: "briyani", quantity: 99 },
    ];
    const total = normaliseBagLines(lines).reduce((sum, line) => sum + line.quantity, 0);
    assert.ok(total <= MAX_UNITS_PER_ORDER, `${total} should be at most ${MAX_UNITS_PER_ORDER}`);
  });

  it("drops junk rather than turning it into an order line", () => {
    const bag = normaliseBagLines([
      { productId: "", quantity: 5 },
      { productId: "kabsah", quantity: 0 },
      { productId: "kabsah", quantity: -3 },
      { productId: "kabsah", quantity: Number.NaN },
      { productId: "mandy", quantity: 2.9 },
    ]);
    assert.deepEqual(bag, [{ productId: "mandy", quantity: 2 }]);
  });

  it("keeps an honest bag exactly as it was", () => {
    const bag = normaliseBagLines([
      { productId: "kabsah", quantity: 2 },
      { productId: "mandy", quantity: 1 },
    ]);
    assert.deepEqual(bag, [
      { productId: "kabsah", quantity: 2 },
      { productId: "mandy", quantity: 1 },
    ]);
  });
});

describe("validating the size of an order", () => {
  it("refuses a bag with more separate lines than the shop sells", () => {
    const items = Array.from({ length: MAX_ITEM_LINES + 1 }, (_, i) => ({
      productId: `product-${i}`,
      quantity: 1,
    }));
    assert.match(validateCheckout(validCheckout(items)).items ?? "", /too many separate items/i);
  });

  it("refuses a wholesale-sized order through the retail checkout", () => {
    const items = [{ productId: "kabsah", quantity: MAX_UNITS_PER_ORDER + 1 }];
    assert.match(validateCheckout(validCheckout(items)).items ?? "", /wholesale/i);
  });

  it("still accepts a normal bag", () => {
    const errors = validateCheckout(validCheckout([{ productId: "kabsah", quantity: 3 }]));
    assert.equal(errors.items, undefined);
  });
});
