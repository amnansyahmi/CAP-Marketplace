import { NextResponse } from "next/server";

import { createPurchase } from "@/lib/chip";
import { hasErrors, validateCheckout, type CheckoutInput } from "@/lib/checkout-schema";
import {
  newOrderId,
  newOrderReference,
  orderStore,
  type Order,
  type OrderItem,
} from "@/lib/orders";
import { productById } from "@/lib/products";
import { quoteShipping, round } from "@/lib/shipping";

/** Uses randomness and a mutable store — must not be prerendered or cached. */
export const dynamic = "force-dynamic";

function baseUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  let body: Partial<CheckoutInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const errors = validateCheckout(body);
  if (hasErrors(errors)) {
    return NextResponse.json({ errors }, { status: 422 });
  }

  // Rebuild every line from the server-side catalogue. Prices sent by the
  // browser are ignored entirely — only product ids and quantities are trusted,
  // and even those are re-checked against the catalogue.
  const items: OrderItem[] = [];
  for (const line of body.items ?? []) {
    const product = productById(line.productId);
    if (!product) {
      return NextResponse.json({ error: `Unknown product: ${line.productId}` }, { status: 422 });
    }
    const quantity = Math.min(99, Math.max(1, Math.floor(line.quantity)));
    items.push({
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      quantity,
      lineTotal: round(product.price * quantity),
    });
  }

  const subtotal = round(items.reduce((sum, i) => sum + i.lineTotal, 0));
  const shippingQuote = quoteShipping(subtotal, body.state!);
  if (!shippingQuote) {
    return NextResponse.json({ errors: { state: "We do not deliver to that state." } }, { status: 422 });
  }
  const total = round(subtotal + shippingQuote.fee);

  const order: Order = {
    id: newOrderId(),
    reference: newOrderReference(),
    status: "pending_payment",
    items,
    customer: {
      fullName: body.fullName!.trim(),
      email: body.email!.trim().toLowerCase(),
      phone: body.phone!.trim(),
    },
    address: {
      line1: body.line1!.trim(),
      line2: body.line2?.trim() || undefined,
      postcode: body.postcode!.trim(),
      city: body.city!.trim(),
      state: body.state!.trim(),
    },
    notes: body.notes?.trim() || undefined,
    subtotal,
    shipping: shippingQuote.fee,
    total,
    currency: "MYR",
    createdAt: new Date().toISOString(),
  };

  await orderStore.create(order);

  const origin = baseUrl(request);
  try {
    const purchase = await createPurchase(order, {
      successUrl: `${origin}/orders/${order.reference}`,
      failureUrl: `${origin}/orders/${order.reference}?payment=failed`,
      callbackUrl: `${origin}/api/webhooks/chip`,
    });

    await orderStore.update(order.id, {
      paymentId: purchase.paymentId,
      paymentUrl: purchase.checkoutUrl,
      // Without a live gateway there is no webhook to confirm payment, so the
      // simulated order is marked paid here to keep the flow demonstrable.
      ...(purchase.live ? {} : { status: "paid" as const, paidAt: new Date().toISOString() }),
    });

    return NextResponse.json({
      reference: order.reference,
      checkoutUrl: purchase.checkoutUrl,
      simulated: !purchase.live,
    });
  } catch (error) {
    await orderStore.update(order.id, { status: "failed" });
    console.error("Failed to create CHIP purchase", error);
    return NextResponse.json(
      { error: "We could not start the payment. Please try again." },
      { status: 502 },
    );
  }
}
