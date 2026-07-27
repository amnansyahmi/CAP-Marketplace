import { NextResponse } from "next/server";

import { verifyWebhookSignature } from "@/lib/chip";
import { canTransition, orderStore, type OrderStatus } from "@/lib/orders";

export const dynamic = "force-dynamic";

/** CHIP event names mapped onto our order statuses. */
const STATUS_BY_EVENT: Record<string, OrderStatus> = {
  "purchase.paid": "paid",
  "purchase.payment_failure": "failed",
  "purchase.cancelled": "cancelled",
  "purchase.expired": "failed",
};

export async function POST(request: Request) {
  // Read the raw body: verification runs over the exact bytes CHIP signed, so
  // this must happen before any JSON parsing.
  const raw = await request.text();
  const signature = request.headers.get("x-signature");

  if (!verifyWebhookSignature(raw, signature)) {
    // Never take a payment state change on an unverified request.
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let event: { event?: string; data?: { id?: string; reference?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const nextStatus = STATUS_BY_EVENT[event.event ?? ""];
  if (!nextStatus) {
    // Unknown but authentic event — acknowledge so CHIP stops retrying.
    return NextResponse.json({ ignored: event.event ?? null });
  }

  const paymentId = event.data?.id;
  const order =
    (paymentId ? await orderStore.byPaymentId(paymentId) : undefined) ??
    (event.data?.reference ? await orderStore.byReference(event.data.reference) : undefined);

  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  if (!canTransition(order.status, nextStatus)) {
    // e.g. a late failure arriving after the payment already settled.
    return NextResponse.json({ status: order.status, ignored: "terminal" });
  }

  await orderStore.update(order.id, {
    status: nextStatus,
    ...(nextStatus === "paid" ? { paidAt: new Date().toISOString() } : {}),
  });

  return NextResponse.json({ status: nextStatus });
}
