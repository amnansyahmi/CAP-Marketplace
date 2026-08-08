/**
 * What the business looks like over time.
 *
 * The admin overview answers "what is happening today". This answers "is the
 * shop growing, and what is actually selling" — which is the question that
 * decides what to make more of.
 *
 * Every figure here nets off refunds, for the same reason revenue does: money
 * given back was never earned, and a best-seller list that counts refunded
 * orders would point the shop at the wrong product.
 */

import { getDb } from "@/lib/db/client";
import { productById } from "@/lib/products";
import { round } from "@/lib/shipping";

export type DailySales = {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  orders: number;
  revenue: number;
};

export type BestSeller = {
  productId: string;
  name: string;
  units: number;
  revenue: number;
};

export type SalesReport = {
  days: DailySales[];
  bestSellers: BestSeller[];
  /** Totals across the window. */
  orders: number;
  revenue: number;
  units: number;
  averageOrderValue: number;
  /** Same length of time immediately before, for comparison. */
  previousRevenue: number;
};

export async function salesReport(days = 30): Promise<SalesReport> {
  const db = await getDb();
  const window = Math.min(365, Math.max(1, Math.floor(days)));

  // generate_series so days with no orders appear as zero rather than being
  // missing — a chart that silently skips quiet days misreads as busier.
  const daily = await db.query<{ day: string; orders: string; revenue: string }>(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(count(o.id) FILTER (WHERE o.id IS NOT NULL), 0)::text AS orders,
            COALESCE(SUM(o.total), 0)::text AS revenue
       FROM generate_series(
              (now() AT TIME ZONE 'UTC')::date - ($1::int - 1),
              (now() AT TIME ZONE 'UTC')::date,
              interval '1 day'
            ) AS d(day)
       LEFT JOIN orders o
              ON (o.paid_at AT TIME ZONE 'UTC')::date = d.day
             AND o.status = 'paid'
             AND o.refunded_at IS NULL
      GROUP BY d.day
      ORDER BY d.day`,
    [window],
  );

  const sellers = await db.query<{ product_id: string; units: string; revenue: string }>(
    `SELECT i.product_id,
            SUM(i.quantity)::text   AS units,
            SUM(i.line_total)::text AS revenue
       FROM order_items i
       JOIN orders o ON o.id = i.order_id
      WHERE o.status = 'paid'
        AND o.refunded_at IS NULL
        AND o.paid_at >= now() - ($1::int || ' days')::interval
      GROUP BY i.product_id
      ORDER BY SUM(i.quantity) DESC`,
    [window],
  );

  // The window immediately before this one, so "up or down" has something to
  // be up or down against.
  const previous = await db.query<{ revenue: string }>(
    `SELECT COALESCE(SUM(total), 0)::text AS revenue
       FROM orders
      WHERE status = 'paid'
        AND refunded_at IS NULL
        AND paid_at >= now() - ($1::int * 2 || ' days')::interval
        AND paid_at <  now() - ($1::int || ' days')::interval`,
    [window],
  );

  const daysOut = daily.rows.map((row) => ({
    date: row.day,
    orders: Number(row.orders),
    revenue: round(Number(row.revenue)),
  }));

  const bestSellers = sellers.rows.map((row) => ({
    productId: row.product_id,
    name: productById(row.product_id)?.name ?? row.product_id,
    units: Number(row.units),
    revenue: round(Number(row.revenue)),
  }));

  const orders = daysOut.reduce((sum, day) => sum + day.orders, 0);
  const revenue = round(daysOut.reduce((sum, day) => sum + day.revenue, 0));
  const units = bestSellers.reduce((sum, seller) => sum + seller.units, 0);

  return {
    days: daysOut,
    bestSellers,
    orders,
    revenue,
    units,
    averageOrderValue: orders > 0 ? round(revenue / orders) : 0,
    previousRevenue: round(Number(previous.rows[0]?.revenue ?? 0)),
  };
}

/**
 * Products running low.
 *
 * Only tracked products can run low — an untracked one has no number to be low
 * against, and warning about it would be noise the owner learns to ignore.
 */
export async function lowStock(threshold = 5): Promise<{ productId: string; name: string; available: number }[]> {
  const { stockLevels } = await import("@/lib/stock");
  return (await stockLevels())
    .filter((level) => level.tracked && level.available <= threshold)
    .map((level) => ({
      productId: level.productId,
      name: productById(level.productId)?.name ?? level.productId,
      available: level.available,
    }))
    .sort((a, b) => a.available - b.available);
}
