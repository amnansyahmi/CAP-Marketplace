/**
 * Bringing courier status back into the shop.
 *
 * Without this, "delivered" only ever means "somebody in the shop noticed and
 * clicked a button". Orders sit at `shipped` forever and the shop cannot tell a
 * parcel that arrived from one lost in a depot.
 *
 * Two rules:
 *
 * 1. **Only ever move forward.** Courier tracking is noisy — a status can
 *    repeat, arrive late or come back out of order. Advancing fulfilment but
 *    never reversing it means a stale event cannot un-deliver a parcel that
 *    already arrived.
 * 2. **Unrecognised wording changes nothing.** `mapParcelStatus` returns null
 *    for anything it does not clearly understand, and null is left alone.
 *    Guessing would email a customer that their parcel arrived when it has not.
 */

import { getDb } from "@/lib/db/client";
import { easyParcelConfig, parcelStatus } from "@/lib/easyparcel";
import { notifyOrderShipped } from "@/lib/notifications/order-events";
import { FULFILMENT_STEPS, orderStore, type Fulfilment } from "@/lib/orders";

export type SyncResult = {
  checked: number;
  advanced: number;
  /** Set when the courier could not be reached at all. */
  error?: string;
};

/** How many parcels to ask about in one sweep. */
const BATCH = 50;

export async function syncParcelStatuses(): Promise<SyncResult> {
  const config = easyParcelConfig();
  if (!config.enabled) return { checked: 0, advanced: 0, error: config.reason };

  const db = await getDb();

  // Only parcels that are actually in flight. A delivered order has nothing
  // left to learn, and an unbooked one has no consignment number to ask about.
  const rows = await db.query<{ id: string; reference: string; tracking_number: string; fulfilment: Fulfilment }>(
    `SELECT id, reference, tracking_number, fulfilment
       FROM orders
      WHERE shipment_state = 'booked'
        AND tracking_number IS NOT NULL
        AND tracking_number <> ''
        AND fulfilment <> 'delivered'
        AND status = 'paid'
        AND refunded_at IS NULL
      ORDER BY shipment_booked_at DESC
      LIMIT $1`,
    [BATCH],
  );

  if (rows.rows.length === 0) return { checked: 0, advanced: 0 };

  const byConsignment = new Map(rows.rows.map((row) => [row.tracking_number, row]));
  const result = await parcelStatus([...byConsignment.keys()]);
  if (!result.ok) return { checked: rows.rows.length, advanced: 0, error: result.error };

  let advanced = 0;

  for (const status of result.statuses) {
    const order = byConsignment.get(status.consignmentNumber);
    if (!order || !status.fulfilment) continue;

    // Never walk backwards: tracking events can arrive late or out of order,
    // and a stale "in transit" must not un-deliver a parcel.
    const current = FULFILMENT_STEPS.indexOf(order.fulfilment);
    const next = FULFILMENT_STEPS.indexOf(status.fulfilment);
    if (next <= current) continue;

    const updated = await orderStore.setFulfilment(order.id, status.fulfilment);
    if (!updated) continue;

    advanced += 1;
    // The customer is told when it ships. `notifyOrderShipped` is claimed in
    // the database, so a parcel that reports "in transit" on every sweep still
    // only ever produces one email.
    if (status.fulfilment === "shipped") await notifyOrderShipped(updated);
  }

  return { checked: rows.rows.length, advanced };
}
