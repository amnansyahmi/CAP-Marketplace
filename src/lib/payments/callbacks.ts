/**
 * What happens when a gateway says a payment moved.
 *
 * Shared by every gateway's callback route: the gateway-specific part is
 * verifying the request and naming the new status, and that is already done by
 * the time this runs. What follows — settling the order, committing or
 * releasing the stock hold, giving a limited discount code back, telling the
 * customer — is the same whoever took the money.
 */

import { NextResponse } from "next/server";

import { discountStore } from "@/lib/discounts";
import { notifyOrderPaid } from "@/lib/notifications/order-events";
import { orderStore, type Order } from "@/lib/orders";
import type { CallbackReading, PaymentGateway } from "@/lib/payments/gateway";
import { commitReservation, releaseReservation } from "@/lib/stock";

/** Half a sen: enough to absorb float representation, far short of a real discrepancy. */
const TOLERANCE = 0.005;

/**
 * Why this payment does not match the order, or undefined when it does.
 *
 * A gateway that does not report the amount returns undefined here, which skips
 * the check rather than failing every payment — the alternative would make the
 * safeguard depend on a field the shop cannot require.
 */
export function paymentMismatch(order: Order, reading: Extract<CallbackReading, { ok: true }>) {
  if (reading.paidCurrency && reading.paidCurrency.toUpperCase() !== order.currency) {
    return `paid in ${reading.paidCurrency}, order is in ${order.currency}`;
  }
  if (reading.paidAmount === undefined) return undefined;
  if (Math.abs(reading.paidAmount - order.total) > TOLERANCE) {
    return `paid ${reading.paidAmount.toFixed(2)}, order total is ${order.total.toFixed(2)}`;
  }
  return undefined;
}

export async function handleGatewayCallback(gateway: PaymentGateway, request: Request) {
  // The raw body, because verification runs over the exact bytes the gateway
  // signed: this must happen before any parsing.
  const raw = await request.text();
  const reading = gateway.readCallback(raw, request.headers);

  if (!reading.ok) {
    // Never take a payment state change on an unverified request.
    return reading.reason === "malformed"
      ? NextResponse.json({ error: "Malformed payload." }, { status: 400 })
      : NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  if (!reading.status) {
    // Authentic but not something we act on — acknowledge so the gateway stops
    // retrying it.
    return NextResponse.json({ ignored: reading.event });
  }

  const order =
    (reading.paymentId ? await orderStore.byPaymentId(reading.paymentId) : undefined) ??
    (reading.reference ? await orderStore.byReference(reading.reference) : undefined);

  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // A verified callback proves the gateway sent it. It does not prove the right
  // amount arrived — that is a separate fact, and the one an attacker would go
  // after: pay RM 1 against an RM 400 order and let the "paid" notice do the
  // rest. Anything that does not reconcile is left pending for a human.
  const mismatch = reading.status === "paid" ? paymentMismatch(order, reading) : undefined;
  if (mismatch) {
    console.error(
      `Refusing to settle order ${order.reference}: ${mismatch}. ` +
        `Gateway ${gateway.label}, payment ${reading.paymentId ?? "unknown"}.`,
    );
    // 200, not an error: the callback was authentic and retrying it would only
    // produce the same mismatch. The order stays pending_payment, which is what
    // the admin's own list shows.
    return NextResponse.json({ ignored: "amount_mismatch", detail: mismatch });
  }

  // The rule that a settled order cannot be moved lives inside the UPDATE, not
  // here: checking it in JavaScript first would let two callbacks arriving
  // together both read `pending_payment` and both decide they may write.
  // A refused change returns undefined.
  const updated = await orderStore.setStatus(order.id, reading.status);

  if (!updated) {
    // e.g. a late failure arriving after the payment already settled.
    return NextResponse.json({ status: order.status, ignored: "terminal" });
  }

  // Only reached when the UPDATE actually moved the order, so a retried
  // callback that found it already settled never gets here.
  if (updated.status === "paid") {
    await commitReservation(updated.id);
  } else {
    await releaseReservation(updated.id);
    // The sale never happened, so a limited code gets its use back.
    await discountStore.release(updated.id);
  }

  await notifyOrderPaid(updated);

  return NextResponse.json({ status: updated.status });
}
