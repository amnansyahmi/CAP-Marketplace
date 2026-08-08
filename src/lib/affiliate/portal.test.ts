/**
 * Affiliate portal tests.
 *
 * Two things decide whether this feature is safe to ship, and they are what
 * these cover:
 *
 * 1. **Isolation.** An affiliate must see their own orders and nobody else's.
 *    The portal is the first place an outsider gets to read anything from the
 *    orders table, so a leak here is a leak to a third party.
 * 2. **No customer personal data.** Affiliates are promoters. They get amounts
 *    and dates, not the buyer's email, phone or address.
 */

process.env.PGLITE_MEMORY = "1";
delete process.env.DATABASE_URL;
process.env.AFFILIATE_SESSION_SECRET = "test-affiliate-secret-value";

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db/client";
import { affiliateStore, commissionFor, type Affiliate } from "@/lib/affiliates";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/affiliate/credentials";
import { earningsFor, listReferredSales } from "@/lib/affiliate/sales";
import { issueSession, readSession, resetThrottleForTests } from "@/lib/affiliate/auth";
import { orderStore, type NewOrder } from "@/lib/orders";

let counter = 0;
const uniqueCode = (prefix = "AFF") => `${prefix}${(counter++).toString().padStart(4, "0")}`;

function draft(overrides: Partial<NewOrder> = {}): NewOrder {
  return {
    items: [{ productId: "kabsah", name: "Kabsah Paste", unitPrice: 19.9, quantity: 2, lineTotal: 39.8 }],
    customer: { fullName: "Siti Nurhaliza Yusof", email: "siti@example.com", phone: "012-345 6789" },
    address: {
      line1: "12 Jalan Rahsia",
      line2: "Taman Privasi",
      postcode: "55100",
      city: "Kuala Lumpur",
      state: "Kuala Lumpur",
    },
    subtotal: 39.8,
    shipping: 8,
    total: 47.8,
    currency: "MYR",
    ...overrides,
  };
}

async function orderVia(affiliate: Affiliate, overrides: Partial<NewOrder> = {}) {
  const base = draft(overrides);
  return orderStore.create({
    ...base,
    affiliateId: affiliate.id,
    affiliateCode: affiliate.code,
    commissionRate: affiliate.commissionRate,
    commissionAmount: commissionFor(base.subtotal, affiliate.commissionRate),
  });
}

before(async () => {
  await getDb();
});

beforeEach(() => resetThrottleForTests());

describe("passwords", () => {
  it("round-trips a correct password", async () => {
    const record = await hashPassword("a-good-long-password");
    assert.equal(await verifyPassword("a-good-long-password", record), true);
  });

  it("rejects a wrong password", async () => {
    const record = await hashPassword("a-good-long-password");
    assert.equal(await verifyPassword("a-good-long-passwore", record), false);
  });

  it("never stores the password in readable form", async () => {
    const record = await hashPassword("correct-horse-battery");
    assert.ok(!record.hash.includes("correct"));
    assert.notEqual(record.hash, "correct-horse-battery");
  });

  it("salts per record, so the same password hashes differently", async () => {
    const a = await hashPassword("identical-password-x");
    const b = await hashPassword("identical-password-x");
    assert.notEqual(a.hash, b.hash, "two affiliates with one password must not share a hash");
  });

  it("treats a missing record as no match rather than a free pass", async () => {
    assert.equal(await verifyPassword("anything", undefined), false);
    assert.equal(await verifyPassword("anything", { hash: undefined, salt: undefined }), false);
    assert.equal(await verifyPassword("", { hash: "", salt: "" }), false);
  });

  it("refuses a password too short to be worth hashing", () => {
    assert.ok(passwordProblem("short"));
    assert.equal(passwordProblem("long-enough-password"), null);
  });
});

describe("signing in", () => {
  it("accepts the right code and password", async () => {
    const code = uniqueCode();
    const affiliate = await affiliateStore.create({
      code,
      name: "Portal User",
      email: "portal@example.com",
      commissionRate: 0.1,
    });
    await affiliateStore.setPassword(affiliate.id, "portal-password-1");

    const signedIn = await affiliateStore.authenticate(code, "portal-password-1");
    assert.equal(signedIn?.id, affiliate.id);
  });

  it("refuses an affiliate who has no password set", async () => {
    const code = uniqueCode();
    await affiliateStore.create({
      code,
      name: "No Password",
      email: "nopass@example.com",
      commissionRate: 0.1,
    });
    // An account nobody has issued a password for must not be openable with
    // an empty one.
    assert.equal(await affiliateStore.authenticate(code, ""), undefined);
    assert.equal(await affiliateStore.authenticate(code, "anything-at-all"), undefined);
  });

  it("refuses a deactivated affiliate even with the right password", async () => {
    const code = uniqueCode();
    const affiliate = await affiliateStore.create({
      code,
      name: "Deactivated",
      email: "gone@example.com",
      commissionRate: 0.1,
    });
    await affiliateStore.setPassword(affiliate.id, "still-knows-it-1");
    await affiliateStore.setActive(affiliate.id, false);

    // Deactivating has to close the portal too, or it would only mean "earns
    // nothing" while they keep reading the sales list.
    assert.equal(await affiliateStore.authenticate(code, "still-knows-it-1"), undefined);
  });

  it("stops working once the password is removed", async () => {
    const code = uniqueCode();
    const affiliate = await affiliateStore.create({
      code,
      name: "Revoked",
      email: "revoked@example.com",
      commissionRate: 0.1,
    });
    await affiliateStore.setPassword(affiliate.id, "was-valid-once-1");
    assert.ok(await affiliateStore.authenticate(code, "was-valid-once-1"));

    await affiliateStore.clearPassword(affiliate.id);
    assert.equal(await affiliateStore.authenticate(code, "was-valid-once-1"), undefined);
  });

  it("gives nothing away about which codes exist", async () => {
    assert.equal(await affiliateStore.authenticate("NOSUCHCODE", "whatever-1234"), undefined);
    assert.equal(await affiliateStore.authenticate("!!!", "whatever-1234"), undefined);
  });
});

describe("sessions", () => {
  it("round-trips the affiliate code", () => {
    const session = issueSession("CHEFCLUB");
    assert.ok(session);
    assert.equal(readSession(session.value), "CHEFCLUB");
  });

  it("rejects a session re-pointed at another affiliate", () => {
    const session = issueSession("CHEFCLUB");
    assert.ok(session);
    const [, expiry, nonce, signature] = session.value.split(".");
    // The attack this exists to stop: swap the code, keep the signature.
    const forged = ["DAPURKITA", expiry, nonce, signature].join(".");
    assert.equal(readSession(forged), null);
  });

  it("rejects an extended expiry", () => {
    const session = issueSession("CHEFCLUB");
    assert.ok(session);
    const [code, expiry, nonce, signature] = session.value.split(".");
    const forged = [code, String(Number(expiry) + 86_400_000), nonce, signature].join(".");
    assert.equal(readSession(forged), null);
  });

  it("rejects an expired session", () => {
    const past = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const session = issueSession("CHEFCLUB", past);
    assert.ok(session);
    assert.equal(readSession(session.value), null);
  });

  it("rejects junk", () => {
    for (const value of ["", "a.b.c", "a.b.c.d", "....", undefined]) {
      assert.equal(readSession(value), null);
    }
  });
});

describe("what an affiliate can see", () => {
  it("shows their own orders and nobody else's", async () => {
    const mine = await affiliateStore.create({
      code: uniqueCode("MINE"),
      name: "Mine",
      email: "mine@example.com",
      commissionRate: 0.1,
    });
    const theirs = await affiliateStore.create({
      code: uniqueCode("THEIR"),
      name: "Theirs",
      email: "theirs@example.com",
      commissionRate: 0.1,
    });

    const a = await orderVia(mine);
    const b = await orderVia(mine);
    const c = await orderVia(theirs);

    const { sales, total } = await listReferredSales(mine.id);
    const references = sales.map((s) => s.reference);

    assert.equal(total, 2);
    assert.ok(references.includes(a.reference));
    assert.ok(references.includes(b.reference));
    assert.ok(
      !references.includes(c.reference),
      "another affiliate's order must never appear in this list",
    );
  });

  it("excludes orders with no affiliate at all", async () => {
    const affiliate = await affiliateStore.create({
      code: uniqueCode("SOLO"),
      name: "Solo",
      email: "solo@example.com",
      commissionRate: 0.1,
    });
    const direct = await orderStore.create(draft());

    const { sales } = await listReferredSales(affiliate.id);
    assert.ok(!sales.some((s) => s.reference === direct.reference));
  });

  it("never returns the customer's contact details or address", async () => {
    const affiliate = await affiliateStore.create({
      code: uniqueCode("PRIV"),
      name: "Privacy",
      email: "privacy@example.com",
      commissionRate: 0.1,
    });
    await orderVia(affiliate);

    const { sales } = await listReferredSales(affiliate.id);
    const serialised = JSON.stringify(sales);

    for (const secret of [
      "siti@example.com",
      "012-345 6789",
      "12 Jalan Rahsia",
      "Taman Privasi",
      "55100",
    ]) {
      assert.ok(
        !serialised.includes(secret),
        `${secret} reached the affiliate portal — it must stay with the shop`,
      );
    }
  });

  it("shows the buyer's first name only", async () => {
    const affiliate = await affiliateStore.create({
      code: uniqueCode("NAME"),
      name: "Names",
      email: "names@example.com",
      commissionRate: 0.1,
    });
    await orderVia(affiliate);

    const { sales } = await listReferredSales(affiliate.id);
    assert.equal(sales[0].buyerFirstName, "Siti");
    assert.ok(!JSON.stringify(sales).includes("Nurhaliza"));
  });
});

describe("earnings", () => {
  it("counts only paid orders as earned", async () => {
    const affiliate = await affiliateStore.create({
      code: uniqueCode("EARN"),
      name: "Earner",
      email: "earner@example.com",
      commissionRate: 0.1,
    });

    const paid = await orderVia(affiliate);
    await orderVia(affiliate); // left pending
    await orderStore.setStatus(paid.id, "paid");

    const earnings = await earningsFor(affiliate.id);
    assert.equal(earnings.paidOrders, 1);
    assert.equal(earnings.pendingOrders, 1);
    // 10% of the 39.80 subtotal, not of the 47.80 total.
    assert.equal(earnings.owed, 3.98);
    assert.equal(earnings.salesSubtotal, 39.8);
  });

  it("owes nothing on an order that failed", async () => {
    const affiliate = await affiliateStore.create({
      code: uniqueCode("FAIL"),
      name: "Failed",
      email: "failed@example.com",
      commissionRate: 0.1,
    });
    const order = await orderVia(affiliate);
    await orderStore.setStatus(order.id, "failed");

    const earnings = await earningsFor(affiliate.id);
    assert.equal(earnings.owed, 0, "a failed order has earned nothing");
    assert.equal(earnings.paidOrders, 0);
  });

  it("moves commission from owed to paid on payout", async () => {
    const affiliate = await affiliateStore.create({
      code: uniqueCode("PAYOUT"),
      name: "Payout",
      email: "payout@example.com",
      commissionRate: 0.1,
    });
    const order = await orderVia(affiliate);
    await orderStore.setStatus(order.id, "paid");

    assert.equal((await earningsFor(affiliate.id)).owed, 3.98);
    await affiliateStore.payOut(affiliate.id);

    const after = await earningsFor(affiliate.id);
    assert.equal(after.owed, 0);
    assert.equal(after.paid, 3.98);
    assert.equal(after.lifetime, 3.98);
  });

  it("agrees with the figure the admin shows", async () => {
    const affiliate = await affiliateStore.create({
      code: uniqueCode("AGREE"),
      name: "Agreement",
      email: "agree@example.com",
      commissionRate: 0.125,
    });
    const order = await orderVia(affiliate);
    await orderStore.setStatus(order.id, "paid");

    // Two views of one payable. If they disagree, one of them is lying to
    // somebody about money.
    const portal = await earningsFor(affiliate.id);
    const admin = await affiliateStore.summary(affiliate.code);
    assert.equal(portal.owed, admin?.commissionOwed);
    assert.equal(portal.paid, admin?.commissionPaid);
    assert.equal(portal.salesSubtotal, admin?.salesSubtotal);
    assert.equal(portal.paidOrders, admin?.orderCount);
  });
});
