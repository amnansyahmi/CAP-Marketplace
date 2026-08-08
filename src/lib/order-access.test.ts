/**
 * Order page access tests.
 *
 * The order page carries a customer's home address and phone number, so the
 * question these answer is: can anyone who is not the buyer open it?
 */

process.env.ORDER_ACCESS_SECRET = "test-order-access-secret-value";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addToOrderCookie,
  cookiePlacedThisOrder,
  issueOrderToken,
  orderAccessConfig,
  readOrderCookie,
  verifyOrderToken,
} from "@/lib/order-access";
import { newOrderReference } from "@/lib/orders";

const env = process.env as Record<string, string | undefined>;

describe("order tokens", () => {
  it("accepts the token issued for that order", () => {
    const token = issueOrderToken("CA-ABC123");
    assert.ok(token);
    assert.equal(verifyOrderToken("CA-ABC123", token), true);
  });

  it("refuses a token issued for a different order", () => {
    // The attack: buy something yourself, then reuse your own link's token on
    // somebody else's reference.
    const mine = issueOrderToken("CA-MINE01");
    assert.ok(mine);
    assert.equal(verifyOrderToken("CA-YOUR02", mine), false);
  });

  it("refuses a missing or malformed token", () => {
    for (const token of [undefined, "", "not-a-token", "AAAA"]) {
      assert.equal(verifyOrderToken("CA-ABC123", token), false);
    }
  });

  it("refuses every token when the secret is unset", () => {
    const saved = env.ORDER_ACCESS_SECRET;
    const token = issueOrderToken("CA-ABC123");
    try {
      delete env.ORDER_ACCESS_SECRET;
      assert.equal(orderAccessConfig().enabled, false);
      // Unconfigured must mean "nobody gets in with a link", never "everybody".
      assert.equal(verifyOrderToken("CA-ABC123", token ?? ""), false);
      assert.equal(issueOrderToken("CA-ABC123"), null);
    } finally {
      env.ORDER_ACCESS_SECRET = saved;
    }
  });

  it("refuses a secret too short to be worth signing with", () => {
    const saved = env.ORDER_ACCESS_SECRET;
    try {
      env.ORDER_ACCESS_SECRET = "short";
      assert.equal(orderAccessConfig().enabled, false);
    } finally {
      env.ORDER_ACCESS_SECRET = saved;
    }
  });
});

describe("the buyer's own browser", () => {
  it("remembers an order it placed", () => {
    const cookie = addToOrderCookie(undefined, "CA-ABC123");
    assert.equal(cookiePlacedThisOrder(cookie, "CA-ABC123"), true);
  });

  it("does not vouch for an order it never placed", () => {
    const cookie = addToOrderCookie(undefined, "CA-ABC123");
    assert.equal(cookiePlacedThisOrder(cookie, "CA-OTHER1"), false);
  });

  it("keeps several orders, most recent first, without duplicates", () => {
    let cookie = addToOrderCookie(undefined, "CA-AAA111");
    cookie = addToOrderCookie(cookie, "CA-BBB222");
    cookie = addToOrderCookie(cookie, "CA-AAA111");
    assert.deepEqual(readOrderCookie(cookie), ["CA-AAA111", "CA-BBB222"]);
  });

  it("ignores anything in the cookie that is not a reference", () => {
    // The cookie is script-writable by design, so its contents are input.
    const tampered = "CA-AAA111,<script>,../../etc/passwd,CA-BBB222,'; DROP TABLE orders; --";
    assert.deepEqual(readOrderCookie(tampered), ["CA-AAA111", "CA-BBB222"]);
  });

  it("caps how many it remembers", () => {
    let cookie: string | undefined;
    for (let i = 0; i < 40; i++) {
      cookie = addToOrderCookie(cookie, `CA-${String(i).padStart(6, "0")}`);
    }
    assert.ok(readOrderCookie(cookie).length <= 12);
  });
});

describe("order references", () => {
  it("has the shape customers read down the phone", () => {
    assert.match(newOrderReference(), /^CA-[0-9A-HJ-NP-Z]{6}$/);
  });

  it("omits the characters that get misread", () => {
    const sample = Array.from({ length: 400 }, () => newOrderReference()).join("");
    assert.ok(!sample.includes("I"), "I reads as 1");
    assert.ok(!sample.includes("O"), "O reads as 0");
  });

  it("does not repeat", () => {
    // Not proof of randomness — a collision here would mean something badly
    // wrong, such as a seeded or fixed generator.
    const seen = new Set(Array.from({ length: 2000 }, () => newOrderReference()));
    assert.equal(seen.size, 2000);
  });

  it("uses the alphabet evenly", () => {
    // Rejection sampling exists so no character is likelier than another. A
    // modulo-biased generator would show the first fourteen symbols roughly
    // 20% more often, throwing away entropy that this value depends on.
    const alphabet = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const counts = new Map<string, number>();
    const draws = 34 * 600;
    for (let i = 0; i < draws / 6; i++) {
      for (const char of newOrderReference().slice(3)) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }
    const expected = draws / alphabet.length;
    for (const char of alphabet) {
      const seen = counts.get(char) ?? 0;
      assert.ok(
        seen > expected * 0.7 && seen < expected * 1.3,
        `${char} appeared ${seen} times, expected around ${expected}`,
      );
    }
  });
});
