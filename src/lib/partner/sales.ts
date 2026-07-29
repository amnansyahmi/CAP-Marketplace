/**
 * Sales reporting for the partner (central) dashboard.
 *
 * This is an integration contract another team builds against, so the shapes
 * here are deliberately explicit rather than leaking the internal `Order` type
 * — internal refactors must not silently break the consumer.
 *
 * **Personal data is excluded.** The dashboard reconciles sales and agent fees,
 * which needs amounts and dates, not customers' names, phone numbers or home
 * addresses. Sending them anyway would spread personal data across systems for
 * no purpose. `state` is included because delivery zone affects the figures.
 */

import { getDb } from "@/lib/db/client";
import type { AgentFeeStatus } from "@/lib/agent";
import type { CommissionStatus, } from "@/lib/affiliates";
import type { OrderStatus } from "@/lib/orders";
import { round } from "@/lib/shipping";

export type SaleLine = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type Sale = {
  reference: string;
  placedAt: string;
  paidAt: string | null;
  status: OrderStatus;
  fulfilment: string;
  currency: "MYR";
  /** Goods only, before delivery and before any discount. */
  subtotal: number;
  /** Code applied, and what it took off the subtotal. Null when none. */
  discountCode: string | null;
  discountAmount: number | null;
  shipping: number;
  total: number;
  /** Jars in the order. */
  units: number;
  items: SaleLine[];
  /** Delivery destination state — affects the shipping figure. */
  state: string;
  /** When the shop refunded this order. Null when it stands. */
  refundedAt: string | null;
  refundAmount: number | null;
  agent: { name: string | null; fee: number; status: AgentFeeStatus } | null;
  affiliate: { code: string; commission: number; status: CommissionStatus } | null;
};

export type SalesSummary = {
  /** Paid orders in range. */
  orders: number;
  units: number;
  /** Goods sold, excluding delivery. */
  netSales: number;
  /** Including delivery — what customers were charged. */
  grossSales: number;
  shippingCollected: number;
  agentFees: { pending: number; paid: number; total: number };
  affiliateCommission: { pending: number; paid: number; total: number };
};

export type SalesQuery = {
  /** Inclusive ISO date or datetime. */
  from?: string;
  /** Exclusive ISO date or datetime. */
  to?: string;
  status?: OrderStatus;
  limit?: number;
  /** Opaque cursor from a previous page. */
  cursor?: string;
};

type SaleRow = {
  id: string;
  reference: string;
  status: OrderStatus;
  fulfilment: string;
  address_state: string;
  subtotal: string;
  shipping: string;
  total: string;
  currency: string;
  created_at: Date | string;
  paid_at: Date | string | null;
  agent_name: string | null;
  agent_fee: string | null;
  agent_fee_status: AgentFeeStatus;
  affiliate_code: string | null;
  commission_amount: string | null;
  commission_status: CommissionStatus;
  refunded_at: Date | string | null;
  refund_amount: string | null;
  discount_code: string | null;
  discount_amount: string | null;
};

type LineRow = {
  order_id: string;
  product_id: string;
  name: string;
  unit_price: string;
  quantity: number;
  line_total: string;
};

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const num = (v: string | null) => (v === null ? 0 : Number(v));

/**
 * Cursor is `<createdAt ISO>|<id>`, encoded. Keyset rather than offset: the
 * dashboard polls a table that is still receiving orders, and an offset would
 * skip or repeat rows as new ones arrive between pages.
 */
function encodeCursor(createdAt: string, id: string) {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Rejects unparseable dates rather than silently returning everything. */
function parseDate(value: string | undefined, label: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${label} date: ${value}`);
  return parsed;
}

export async function listSales(query: SalesQuery) {
  const db = await getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  const from = parseDate(query.from, "from");
  const to = parseDate(query.to, "to");

  if (from) {
    params.push(from.toISOString());
    where.push(`created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to.toISOString());
    where.push(`created_at < $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    where.push(`status = $${params.length}`);
  }

  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (!decoded) throw new Error("Invalid cursor.");
    params.push(decoded.createdAt, decoded.id);
    // Tie-break on id so orders sharing a timestamp are never skipped.
    where.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
  }

  const limit = Math.min(200, Math.max(1, query.limit ?? 50));
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await db.query<SaleRow>(
    `SELECT id, reference, status, fulfilment, address_state, subtotal, shipping, total,
            currency, created_at, paid_at,
            agent_name, agent_fee, agent_fee_status,
            affiliate_code, commission_amount, commission_status,
            refunded_at, refund_amount, discount_code, discount_amount
       FROM orders ${clause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length + 1}`,
    [...params, limit + 1], // one extra row tells us whether more exist
  );

  const page = rows.rows.slice(0, limit);
  const hasMore = rows.rows.length > limit;

  const ids = page.map((r) => r.id);
  const lines = ids.length
    ? await db.query<LineRow>(
        `SELECT order_id, product_id, name, unit_price, quantity, line_total
           FROM order_items WHERE order_id = ANY($1) ORDER BY position`,
        [ids],
      )
    : { rows: [] };

  const byOrder = new Map<string, LineRow[]>();
  for (const line of lines.rows) {
    const list = byOrder.get(line.order_id) ?? [];
    list.push(line);
    byOrder.set(line.order_id, list);
  }

  const data: Sale[] = page.map((row) => {
    const items = (byOrder.get(row.id) ?? []).map((l) => ({
      productId: l.product_id,
      name: l.name,
      quantity: l.quantity,
      unitPrice: num(l.unit_price),
      lineTotal: num(l.line_total),
    }));
    return {
      reference: row.reference,
      placedAt: iso(row.created_at),
      paidAt: row.paid_at ? iso(row.paid_at) : null,
      status: row.status,
      fulfilment: row.fulfilment,
      currency: row.currency as "MYR",
      subtotal: num(row.subtotal),
      // Without this the figures do not reconcile: subtotal + shipping would
      // not equal total on any discounted order, which reads as a bug to
      // whoever is checking the numbers.
      discountCode: row.discount_code,
      discountAmount: row.discount_amount != null ? num(row.discount_amount) : null,
      shipping: num(row.shipping),
      total: num(row.total),
      units: items.reduce((sum, i) => sum + i.quantity, 0),
      items,
      // The dashboard reconciles fees against sales, so a refunded order has
      // to be visible as such — otherwise it keeps counting income the shop
      // gave back, and an agent fee that was voided.
      refundedAt: row.refunded_at ? iso(row.refunded_at) : null,
      refundAmount: row.refund_amount != null ? num(row.refund_amount) : null,
      state: row.address_state,
      agent: row.agent_fee === null
        ? null
        : { name: row.agent_name, fee: num(row.agent_fee), status: row.agent_fee_status },
      affiliate: row.affiliate_code
        ? {
            code: row.affiliate_code,
            commission: num(row.commission_amount),
            status: row.commission_status,
          }
        : null,
    };
  });

  const last = page[page.length - 1];
  return {
    data,
    pagination: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(iso(last.created_at), last.id) : null,
    },
  };
}

export async function salesSummary(query: Pick<SalesQuery, "from" | "to">): Promise<SalesSummary> {
  const db = await getDb();
  const where: string[] = [`status = 'paid'`]; // an unpaid order is not a sale
  const params: unknown[] = [];

  const from = parseDate(query.from, "from");
  const to = parseDate(query.to, "to");
  if (from) {
    params.push(from.toISOString());
    where.push(`created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to.toISOString());
    where.push(`created_at < $${params.length}`);
  }

  const rows = await db.query<{
    orders: string;
    net_sales: string;
    gross_sales: string;
    shipping: string;
    agent_pending: string;
    agent_paid: string;
    aff_pending: string;
    aff_paid: string;
  }>(
    `SELECT count(*)::text                                        AS orders,
            COALESCE(SUM(subtotal), 0)::text                      AS net_sales,
            COALESCE(SUM(total), 0)::text                         AS gross_sales,
            COALESCE(SUM(shipping), 0)::text                      AS shipping,
            COALESCE(SUM(agent_fee) FILTER (WHERE agent_fee_status = 'pending'), 0)::text AS agent_pending,
            COALESCE(SUM(agent_fee) FILTER (WHERE agent_fee_status = 'paid'), 0)::text    AS agent_paid,
            COALESCE(SUM(commission_amount) FILTER (WHERE commission_status = 'pending'), 0)::text AS aff_pending,
            COALESCE(SUM(commission_amount) FILTER (WHERE commission_status = 'paid'), 0)::text    AS aff_paid
       FROM orders WHERE ${where.join(" AND ")}`,
    params,
  );

  const unitRows = await db.query<{ units: string }>(
    `SELECT COALESCE(SUM(oi.quantity), 0)::text AS units
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE ${where.map((w) => w.replace(/\b(status|created_at)\b/g, "o.$1")).join(" AND ")}`,
    params,
  );

  const r = rows.rows[0];
  const agentPending = num(r?.agent_pending ?? null);
  const agentPaid = num(r?.agent_paid ?? null);
  const affPending = num(r?.aff_pending ?? null);
  const affPaid = num(r?.aff_paid ?? null);

  return {
    orders: Number(r?.orders ?? 0),
    units: Number(unitRows.rows[0]?.units ?? 0),
    netSales: num(r?.net_sales ?? null),
    grossSales: num(r?.gross_sales ?? null),
    shippingCollected: num(r?.shipping ?? null),
    agentFees: { pending: agentPending, paid: agentPaid, total: round(agentPending + agentPaid) },
    affiliateCommission: {
      pending: affPending,
      paid: affPaid,
      total: round(affPending + affPaid),
    },
  };
}
