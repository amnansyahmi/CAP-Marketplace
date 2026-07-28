/**
 * Agent fee and partner API tests.
 *
 * The agent fee is a payable to KretivWork and the partner feed is a contract
 * another team builds against, so these pin down the arithmetic, the pagination
 * behaviour the dashboard depends on, and the promise that customer personal
 * data stays in this system.
 */

process.env.PGLITE_MEMORY = "1";
delete process.env.DATABASE_URL;

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { agentConfig, agentFeeFor, totalUnits } from "@/lib/agent";
import { authenticatePartner } from "@/lib/partner/auth";
import { listSales, salesSummary } from "@/lib/partner/sales";
import { getDb } from "@/lib/db/client";
import { orderStore, type NewOrder } from "@/lib/orders";

const KEY = "partner-key-long-enough-to-be-valid";

function draft(overrides: Partial<NewOrder> = {}): NewOrder {
  const items = overrides.items ?? [
    { productId: "kabsah", name: "Kabsah Paste", unitPrice: 19.9, quantity: 2, lineTotal: 39.8 },
  ];
  const subtotal = overrides.subtotal ?? items.reduce((s, i) => s + i.lineTotal, 0);
  return {
    items,
    customer: { fullName: "Nur Amina", email: "amina@example.com", phone: "012-345 6789" },
    address: { line1: "12 Jalan Rahsia", postcode: "55100", city: "Kuala Lumpur", state: "Kuala Lumpur" },
    subtotal,
    shipping: 8,
    total: subtotal + 8,
    currency: "MYR",
    ...overrides,
  };
}

/** Places an order the way the order API does, applying the agent fee. */
async function sell(overrides: Partial<NewOrder> = {}, { paid = true } = {}) {
  const base = draft(overrides);
  const config = agentConfig();
  const fee = agentFeeFor(totalUnits(base.items), config);
  const order = await orderStore.create({
    ...base,
    ...(fee > 0 ? { agentName: config.name, agentFee: fee } : {}),
  });
  if (paid) await orderStore.setStatus(order.id, "paid");
  return order;
}

before(async () => {
  await getDb();
});

beforeEach(() => {
  delete process.env.AGENT_FEE_BASIS;
  delete process.env.AGENT_FEE_PER_SALE;
  delete process.env.AGENT_NAME;
  process.env.PARTNER_API_KEY = KEY;
});

describe("agent fee", () => {
  it("defaults to RM 2 per order for KretivWork", () => {
    const config = agentConfig();
    assert.equal(config.name, "KretivWork");
    assert.equal(config.feePerSale, 2);
    assert.equal(config.basis, "order");
  });

  it("charges once per order on the default basis, whatever the quantity", () => {
    // The distinction that matters: 4 jars is still one sale.
    assert.equal(agentFeeFor(1), 2);
    assert.equal(agentFeeFor(4), 2);
    assert.equal(agentFeeFor(12), 2);
  });

  it("charges per jar on the unit basis", () => {
    process.env.AGENT_FEE_BASIS = "unit";
    assert.equal(agentFeeFor(1), 2);
    assert.equal(agentFeeFor(4), 8, "a four-jar order should pay four fees on the unit basis");
  });

  it("honours a different fee", () => {
    process.env.AGENT_FEE_PER_SALE = "3.50";
    assert.equal(agentFeeFor(1), 3.5);
  });

  it("is disabled at a zero fee", () => {
    process.env.AGENT_FEE_PER_SALE = "0";
    assert.equal(agentConfig().enabled, false);
    assert.equal(agentFeeFor(5), 0);
  });

  it("falls back to the default rather than charging nothing on a bad value", () => {
    process.env.AGENT_FEE_PER_SALE = "not-a-number";
    assert.equal(agentConfig().feePerSale, 2);
  });

  it("applies to every sale, referred or not", async () => {
    const order = await sell();
    assert.equal(order.agentFee, 2);
    assert.equal(order.agentName, "KretivWork");
    assert.equal(order.agentFeeStatus, "pending");
    assert.equal(order.affiliateCode, undefined, "this order had no referral, yet still owes the agent");
  });

  it("snapshots the fee so renegotiating does not rewrite history", async () => {
    const order = await sell();
    assert.equal(order.agentFee, 2);

    process.env.AGENT_FEE_PER_SALE = "5";
    const reread = await orderStore.byReference(order.reference);
    assert.equal(reread?.agentFee, 2, "an existing order's agent fee changed with the configured rate");

    const later = await sell();
    assert.equal(later.agentFee, 5, "the new fee was not applied to a later sale");
  });

  it("voids the fee when an order fails", async () => {
    const order = await sell({}, { paid: false });
    await orderStore.setStatus(order.id, "failed");
    const reread = await orderStore.byReference(order.reference);
    assert.equal(reread?.agentFeeStatus, "void", "a failed order still owed the agent");
  });

  it("counts only paid orders as owed", async () => {
    const before = (await orderStore.stats()).agentFeesOwed;
    await sell({}, { paid: false });
    assert.equal((await orderStore.stats()).agentFeesOwed, before, "an unpaid order was counted as owed");
    await sell();
    assert.equal((await orderStore.stats()).agentFeesOwed, before + 2);
  });
});

describe("partner API authentication", () => {
  const req = (headers: Record<string, string> = {}) =>
    new Request("https://example.test/api/partner/sales", { headers });

  it("accepts the configured key as a bearer token", () => {
    assert.equal(authenticatePartner(req({ authorization: `Bearer ${KEY}` })).ok, true);
  });

  it("accepts the key via X-API-Key", () => {
    assert.equal(authenticatePartner(req({ "x-api-key": KEY })).ok, true);
  });

  it("rejects a missing key", () => {
    const result = authenticatePartner(req());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
  });

  it("rejects a wrong key", () => {
    const result = authenticatePartner(req({ authorization: "Bearer wrong-key-but-long-enough-here" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
  });

  it("is disabled, not open, when no key is configured", () => {
    delete process.env.PARTNER_API_KEY;
    const result = authenticatePartner(req({ authorization: "Bearer anything" }));
    assert.equal(result.ok, false, "the API answered without a key configured");
    if (!result.ok) assert.equal(result.status, 503);
  });

  it("refuses a key that is too short to be safe", () => {
    process.env.PARTNER_API_KEY = "short";
    const result = authenticatePartner(req({ authorization: "Bearer short" }));
    assert.equal(result.ok, false, "a trivially guessable key was accepted");
  });
});

describe("sales feed", () => {
  it("reports amounts, units and the agent fee", async () => {
    const order = await sell();
    const { data } = await listSales({ limit: 200 });
    const sale = data.find((s) => s.reference === order.reference);
    assert.ok(sale, "the sale was missing from the feed");
    assert.equal(sale.subtotal, 39.8);
    assert.equal(sale.shipping, 8);
    assert.equal(sale.total, 47.8);
    assert.equal(sale.units, 2);
    assert.equal(sale.agent?.fee, 2);
    assert.equal(sale.items.length, 1);
  });

  it("does not expose customer personal data", async () => {
    await sell();
    const { data } = await listSales({ limit: 5 });
    const serialised = JSON.stringify(data);
    for (const leak of ["Nur Amina", "amina@example.com", "012-345 6789", "12 Jalan Rahsia", "55100"]) {
      assert.ok(!serialised.includes(leak), `the feed leaked personal data: ${leak}`);
    }
    // Delivery state is included deliberately — it explains the shipping figure.
    assert.ok(serialised.includes("Kuala Lumpur"));
  });

  it("pages without repeating or skipping orders", async () => {
    for (let i = 0; i < 7; i++) await sell();
    const first = await listSales({ limit: 3 });
    assert.equal(first.data.length, 3);
    assert.ok(first.pagination.hasMore);
    assert.ok(first.pagination.nextCursor);

    const second = await listSales({ limit: 3, cursor: first.pagination.nextCursor! });
    const overlap = first.data.filter((a) => second.data.some((b) => b.reference === a.reference));
    assert.equal(overlap.length, 0, "the same order appeared on two pages");
  });

  it("keeps paging stable when new orders arrive mid-sync", async () => {
    for (let i = 0; i < 4; i++) await sell();
    const first = await listSales({ limit: 2 });
    // A new order lands between requests, as it would during a real sync.
    await sell();
    const second = await listSales({ limit: 2, cursor: first.pagination.nextCursor! });
    const overlap = first.data.filter((a) => second.data.some((b) => b.reference === a.reference));
    assert.equal(overlap.length, 0, "an insert between pages caused an order to repeat");
  });

  it("rejects a bad cursor rather than returning everything", async () => {
    await assert.rejects(() => listSales({ cursor: "not-a-cursor" }), /Invalid cursor/);
  });

  it("rejects an unparseable date rather than ignoring the filter", async () => {
    await assert.rejects(() => listSales({ from: "last tuesday" }), /Invalid from date/);
  });

  it("filters by date range", async () => {
    const order = await sell();
    const future = new Date(Date.now() + 86400000).toISOString();
    const { data } = await listSales({ from: future, limit: 50 });
    assert.ok(!data.some((s) => s.reference === order.reference), "a date filter did not exclude an older order");
  });
});

describe("sales summary", () => {
  it("counts settled orders only and totals the agent fees", async () => {
    const before = await salesSummary({});

    await sell({}, { paid: false }); // must not count
    const afterUnpaid = await salesSummary({});
    assert.equal(afterUnpaid.orders, before.orders, "an unpaid order was counted as a sale");

    await sell();
    const after = await salesSummary({});
    assert.equal(after.orders, before.orders + 1);
    assert.equal(after.units, before.units + 2);
    assert.equal(after.netSales, before.netSales + 39.8, "net sales should exclude delivery");
    assert.equal(after.grossSales, before.grossSales + 47.8);
    assert.equal(after.agentFees.pending, before.agentFees.pending + 2);
  });

  it("separates goods from delivery", async () => {
    const summary = await salesSummary({});
    assert.equal(
      Math.round((summary.netSales + summary.shippingCollected) * 100) / 100,
      summary.grossSales,
      "net sales plus delivery should equal gross",
    );
  });
});
