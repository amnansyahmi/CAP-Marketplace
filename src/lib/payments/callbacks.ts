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
import { orderStore } from "@/lib/orders";
import type { PaymentGateway } from "@/lib/payments/gateway";
import { commitReservation, releaseReservation } from "@/lib/stock";

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
