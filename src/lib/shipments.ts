/**
 * Booking a parcel with the courier.
 *
 * Booking spends real EasyParcel credit, which makes this the most expensive
 * thing in the shop to get wrong: a double booking is a second parcel, a second
 * charge, and a customer receiving two boxes. So the claim comes first and the
 * courier call second.
 *
 * `shipment_state` moves `none -> booking -> booked | failed`, and the claim is
 * the UPDATE itself. Whoever moves it to `booking` owns the attempt; a second
 * click finds the row already claimed and stops without calling the courier.
 * A failure returns the row to `none` so the shop owner can genuinely retry —
 * leaving it stuck at `booking` would mean a transient network error locked an
 * order out of ever being shipped.
 */

import { getDb } from "@/lib/db/client";
import { bookShipment, easyParcelConfig, type BookingRequest } from "@/lib/easyparcel";
import { parcelContents, parcelFor } from "@/lib/parcel";
import { orderStore, type Order } from "@/lib/orders";

export type BookingOutcome =
  | { ok: true; order: Order; consignmentNumber?: string }
  | { ok: false; reason: string };

/** Takes the booking claim, or reports why it could not. */
async function claim(orderId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    `UPDATE orders SET shipment_state = 'booking', shipment_error = NULL
      WHERE id = $1 AND shipment_state IN ('none','failed')
      RETURNING id`,
    [orderId],
  );
  return rows.rows.length === 1;
}

async function recordFailure(orderId: string, error: string): Promise<void> {
  const db = await getDb();
  // Back to 'none', not stuck at 'booking': a network blip must not lock an
  // order out of ever being shipped.
  await db.query(
    `UPDATE orders SET shipment_state = 'none', shipment_error = $2 WHERE id = $1`,
    [orderId, error.slice(0, 500)],
  );
}

/**
 * Books the parcel for an order.
 *
 * Only a paid order can be booked — posting goods for money that never arrived
 * is the one mistake a courier integration must not make easy.
 */
export async function bookOrderShipment(orderId: string): Promise<BookingOutcome> {
  const config = easyParcelConfig();
  if (!config.enabled) return { ok: false, reason: `EasyParcel is not configured: ${config.reason}` };

  const order = await orderById(orderId);
  if (!order) return { ok: false, reason: "That order does not exist." };
  if (order.status !== "paid") return { ok: false, reason: "Only a paid order can be shipped." };
  if (order.refundedAt) return { ok: false, reason: "That order was refunded." };
  if (order.shipmentState === "booked") {
    return { ok: false, reason: "A shipment has already been booked for this order." };
  }
  if (!order.deliveryServiceId) {
    return { ok: false, reason: "This order has no courier service on it — it was placed on the flat rate." };
  }

  if (!(await claim(order.id))) {
    return { ok: false, reason: "A booking is already in progress for this order." };
  }

  const request: BookingRequest = {
    serviceId: order.deliveryServiceId,
    reference: order.reference,
    destination: {
      postcode: order.address.postcode,
      state: order.address.state,
      country: "MY",
      contactName: order.customer.fullName,
      contactPhone: order.customer.phone,
      contactEmail: order.customer.email,
      addressLine1: order.address.line1,
      addressLine2: order.address.line2,
      city: order.address.city,
    },
    parcel: parcelFor(order.items.map((i) => ({ productId: i.productId, quantity: i.quantity }))),
    contents: parcelContents(order.items.map((i) => ({ productId: i.productId, quantity: i.quantity }))),
    // Insured for the goods, not the postage — the courier is not liable for
    // its own fee.
    declaredValue: order.subtotal,
  };

  const result = await bookShipment(request);

  if (!result.ok) {
    await recordFailure(order.id, result.error);
    return { ok: false, reason: result.error };
  }

  const db = await getDb();
  await db.query(
    `UPDATE orders
        SET shipment_state = 'booked',
            shipment_order_number = $2,
            shipment_awb_url = $3,
            shipment_booked_at = now(),
            shipment_error = NULL,
            delivery_courier = COALESCE($4, delivery_courier),
            -- Only fill the tracking number if the courier gave one; an empty
            -- string here would email the customer a blank to track with.
            tracking_number = COALESCE(NULLIF($5, ''), tracking_number)
      WHERE id = $1`,
    [
      order.id,
      result.booking.orderNumber,
      result.booking.awbUrl ?? null,
      result.booking.courierName ?? null,
      result.booking.consignmentNumber ?? "",
    ],
  );

  const updated = await orderById(order.id);
  return {
    ok: true,
    order: updated ?? order,
    consignmentNumber: result.booking.consignmentNumber,
  };
}

async function orderById(id: string): Promise<Order | undefined> {
  const db = await getDb();
  const rows = await db.query<{ reference: string }>(`SELECT reference FROM orders WHERE id = $1`, [id]);
  const reference = rows.rows[0]?.reference;
  return reference ? orderStore.byReference(reference) : undefined;
}
