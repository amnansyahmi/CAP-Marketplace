/**
 * What an affiliate may see of the orders they referred.
 *
 * The governing decision: **an affiliate is a promoter, not the merchant.**
 * They earn a percentage for sending a buyer, and to trust the figure they need
 * to see which orders were counted, when, for how much, and what they earned.
 * None of that requires knowing where the buyer lives.
 *
 * So this query returns amounts, dates and states, plus the buyer's first name
 * only — enough for an affiliate to recognise a sale they know they drove
 * without handing a third party a customer list. Email, phone, address lines,
 * postcode and order notes are never selected, so they cannot leak through a
 * component that renders more than it meant to.
 *
 * Every function here takes an `affiliateId` that the caller must have got from
 * the session. Nothing accepts a code from a URL.
 */

import { getDb } from "@/lib/db/client";
import type { CommissionStatus } from "@/lib/affiliates";
import type { OrderStatus } from "@/lib/orders";
import { round } from "@/lib/shipping";

export type ReferredSale = {
  reference: string;
  placedAt: string;
  paidAt: string | null;
  status: OrderStatus;
  /** First name only — enough to recognise a sale, not to contact anyone. */
  buyerFirstName: string;
  /** Delivery state. Coarse enough not to identify anyone. */
  state: string;
  /** Jars in the order. */
  units: number;
  /** Goods only. Commission is a percentage of this, never of delivery. */
  subtotal: number;
  /** The rate frozen onto this order, which may differ from the current one. */
  commissionRate: number;
  commission: number;
  commissionStatus: CommissionStatus;
};

export type AffiliateEarnings = {
  /** Orders referred and paid for. */
  paidOrders: number;
  /** Referred but not yet settled — nothing is earned on these yet. */
  pendingOrders: number;
  /** Goods subtotal across paid referred orders. */
  salesSubtotal: number;
  /** Earned, awaiting payout. */
  owed: number;
  /** Already paid out. */
  paid: number;
  /** Clicks cannot be measured here, so this is orders per paid order. */
  lifetime: number;
};

type SaleRow = {
  reference: string;
  created_at: Date | string;
  paid_at: Date | string | null;
  status: OrderStatus;
  customer_full_name: string;
  address_state: string;
  units: string | null;
  subtotal: string;
  commission_rate: string | null;
  commission_amount: string | null;
  commission_status: CommissionStatus;
};

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/**
 * The buyer's given name.
 *
 * Malaysian names commonly carry patronymics ("bin", "binti", "a/l", "a/p") and
 * the given name is the first token either way, so taking it is safe across the
 * naming conventions in this shop's customer base.
 */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

export async function listReferredSales(
  affiliateId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<{ sales: ReferredSale[]; total: number }> {
  const db = await getDb();
  const capped = Math.min(Math.max(1, limit), 100);

  const rows = await db.query<SaleRow>(
    `SELECT o.reference, o.created_at, o.paid_at, o.status,
            o.customer_full_name, o.address_state,
            o.subtotal, o.commission_rate, o.commission_amount, o.commission_status,
            (SELECT SUM(quantity)::text FROM order_items i WHERE i.order_id = o.id) AS units
       FROM orders o
      WHERE o.affiliate_id = $1
      ORDER BY o.created_at DESC
      LIMIT $2 OFFSET $3`,
    [affiliateId, capped, Math.max(0, offset)],
  );

  const counted = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM orders WHERE affiliate_id = $1`,
    [affiliateId],
  );

  return {
    sales: rows.rows.map((row) => ({
      reference: row.reference,
      placedAt: iso(row.created_at),
      paidAt: row.paid_at ? iso(row.paid_at) : null,
      status: row.status,
      buyerFirstName: firstName(row.customer_full_name),
      state: row.address_state,
      units: Number(row.units ?? 0),
      subtotal: Number(row.subtotal),
      commissionRate: Number(row.commission_rate ?? 0),
      commission: Number(row.commission_amount ?? 0),
      commissionStatus: row.commission_status,
    })),
    total: Number(counted.rows[0]?.total ?? 0),
  };
}

export async function earningsFor(affiliateId: string): Promise<AffiliateEarnings> {
  const db = await getDb();
  const rows = await db.query<{
    paid_orders: string;
    pending_orders: string;
    sales_subtotal: string;
    owed: string;
    paid: string;
  }>(
    // "Owed" means earned and unpaid, which is commission pending on an order
    // that actually settled. Filtering on commission_status alone would show
    // commission for orders that were never completed and promise the
    // affiliate money nobody owes them.
    `SELECT count(*) FILTER (WHERE status = 'paid')::text                        AS paid_orders,
            count(*) FILTER (WHERE status = 'pending_payment')::text             AS pending_orders,
            COALESCE(SUM(subtotal) FILTER (WHERE status = 'paid'), 0)::text      AS sales_subtotal,
            COALESCE(SUM(commission_amount) FILTER (
              WHERE commission_status = 'pending' AND status = 'paid'
            ), 0)::text                                                          AS owed,
            COALESCE(SUM(commission_amount) FILTER (
              WHERE commission_status = 'paid'
            ), 0)::text                                                          AS paid
       FROM orders
      WHERE affiliate_id = $1`,
    [affiliateId],
  );

  const row = rows.rows[0];
  const owed = round(Number(row?.owed ?? 0));
  const paid = round(Number(row?.paid ?? 0));

  return {
    paidOrders: Number(row?.paid_orders ?? 0),
    pendingOrders: Number(row?.pending_orders ?? 0),
    salesSubtotal: round(Number(row?.sales_subtotal ?? 0)),
    owed,
    paid,
    lifetime: round(owed + paid),
  };
}
