import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { affiliateStore, commissionFor } from "@/lib/affiliates";
import { agentConfig, agentFeeFor, totalUnits } from "@/lib/agent";
import { REFERRAL_COOKIE } from "@/middleware";
import { createPurchase } from "@/lib/chip";
import { hasErrors, validateCheckout, type CheckoutInput } from "@/lib/checkout-schema";
import { notifyOrderPaid } from "@/lib/notifications/order-events";
import { ORDER_COOKIE, addToOrderCookie, issueOrderToken } from "@/lib/order-access";
import { orderStore, type NewOrder, type OrderItem } from "@/lib/orders";
import { productById } from "@/lib/products";
import { round } from "@/lib/shipping";
import { priceDelivery } from "@/lib/delivery";
import { discountStore, normaliseDiscountCode } from "@/lib/discounts";
import { commitReservation, markReserved, releaseReservation, reserve } from "@/lib/stock";
import { productById as lookupProduct } from "@/lib/products";

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

  // Redeemed here, not merely checked: the claim is what enforces a usage
  // limit. A code that fails is refused outright rather than quietly ignored —
  // a customer who typed one expects it to be applied or to be told why.
  const claimedDiscount = normaliseDiscountCode(body.discountCode);
  let discount: { code: string; amount: number } | undefined;
  if (claimedDiscount) {
    const redeemed = await discountStore.redeem(claimedDiscount, subtotal);
    if (!redeemed.ok) {
      return NextResponse.json({ errors: { discountCode: redeemed.reason } }, { status: 422 });
    }
    discount = { code: redeemed.code, amount: redeemed.amount };
  }

  // The discount comes off goods only. Delivery is owed to a courier whatever
  // the customer paid for the jars.
  const discountedSubtotal = round(subtotal - (discount?.amount ?? 0));

  // Re-priced here rather than trusted from the browser, exactly like the line
  // prices: a postage figure that arrives from a client is a suggestion. If
  // the chosen courier has withdrawn its service since the quote, this falls
  // back rather than stranding the customer on the payment page.
  const delivery = await priceDelivery(
    items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    { postcode: body.postcode!.trim(), state: body.state!.trim() },
    discountedSubtotal,
    typeof body.deliveryServiceId === "string" ? body.deliveryServiceId : undefined,
  );
  if (!delivery) {
    return NextResponse.json({ errors: { state: "We do not deliver to that state." } }, { status: 422 });
  }
  const total = round(discountedSubtotal + delivery.price);

  // Referral attribution. The cookie only carries a claimed code; it is looked
  // up here and ignored unless it belongs to an active affiliate, so a customer
  // editing the cookie cannot invent a commission or pick a different rate.
  // Commission is taken on the subtotal, never the total — delivery is a
  // pass-through cost, not margin.
  const jar = await cookies();
  const claimedCode = jar.get(REFERRAL_COOKIE)?.value;
  const affiliate = claimedCode ? await affiliateStore.activeByCode(claimedCode) : undefined;
  const attribution = affiliate
    ? {
        affiliateId: affiliate.id,
        affiliateCode: affiliate.code,
        // Snapshotted: a later rate change must not rewrite this order.
        commissionRate: affiliate.commissionRate,
        // On what the shop actually received. Paying a percentage of the
        // pre-discount figure would send money out on revenue that never
        // arrived — the same error as paying commission on delivery.
        commissionAmount: commissionFor(discountedSubtotal, affiliate.commissionRate),
      }
    : {};

  // The sole agent earns on every sale, referred or not, so this is applied
  // unconditionally and independently of any affiliate commission above.
  const agent = agentConfig();
  const agentFee = agentFeeFor(totalUnits(items), agent);

  const draft: NewOrder = {
    ...attribution,
    ...(agentFee > 0 ? { agentName: agent.name, agentFee } : {}),
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
    ...(discount ? { discountCode: discount.code, discountAmount: discount.amount } : {}),
    shipping: delivery.price,
    // Kept apart from what the customer paid: free delivery means the shop
    // absorbs the courier's fee, and folding them together would hide that.
    deliveryCost: delivery.cost,
    ...(delivery.serviceId
      ? {
          deliveryServiceId: delivery.serviceId,
          deliveryCourier: delivery.courierName,
          deliveryServiceName: delivery.serviceName,
        }
      : {}),
    total,
    currency: "MYR",
  };

  // Stock is held before the order exists, so a customer is never given an
  // order number for jars the shop cannot ship.
  const held = await reserve(items.map((i) => ({ productId: i.productId, quantity: i.quantity })));
  if (!held.ok) {
    const detail = held.shortfalls
      .map((s) => {
        const name = lookupProduct(s.productId)?.name ?? s.productId;
        return s.available === 0 ? `${name} is sold out` : `only ${s.available} left of ${name}`;
      })
      .join(", ");
    return NextResponse.json(
      { error: `Sorry — ${detail}. Please adjust your bag and try again.`, shortfalls: held.shortfalls },
      { status: 409 },
    );
  }

  // Persisted before contacting the gateway, so a payment can always be traced
  // back to an order even if the process dies mid-request.
  const order = await orderStore.create(draft);
  await markReserved(order.id);

  const origin = baseUrl(request);
  // Carried on the gateway return links too: the customer may well come back
  // from CHIP in a different tab or app, where only the URL travels with them.
  const token = issueOrderToken(order.reference);
  const query = token ? `?t=${token}` : "";
  try {
    const purchase = await createPurchase(order, {
      successUrl: `${origin}/orders/${order.reference}${query}`,
      failureUrl: `${origin}/orders/${order.reference}${query}${query ? "&" : "?"}payment=failed`,
      callbackUrl: `${origin}/api/webhooks/chip`,
    });

    const settled = await orderStore.attachPayment(order.id, {
      paymentId: purchase.paymentId,
      paymentUrl: purchase.checkoutUrl,
      // Without a live gateway there is no webhook to confirm payment, so the
      // simulated order is settled here to keep the flow demonstrable.
      markPaid: !purchase.live,
    });

    // With a live gateway the confirmation is sent from the webhook instead,
    // once CHIP says the money actually arrived.
    if (settled?.status === "paid") {
      await commitReservation(settled.id);
      await notifyOrderPaid(settled);
    }

    const response = NextResponse.json({
      reference: order.reference,
      accessToken: token,
      checkoutUrl: purchase.checkoutUrl,
      simulated: !purchase.live,
    });

    // Lets this browser reopen its own orders later without the emailed link.
    // Readable by script on purpose: it is a list of references the visitor
    // already has, not a credential — the signature is what authorises.
    response.cookies.set(ORDER_COOKIE, addToOrderCookie(jar.get(ORDER_COOKIE)?.value, order.reference), {
      maxAge: 180 * 24 * 60 * 60,
      sameSite: "lax",
      path: "/",
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (error) {
    await orderStore.setStatus(order.id, "failed");
    // The gateway never got the order, so the jars — and the redemption of any
    // limited code — go straight back.
    await releaseReservation(order.id);
    await discountStore.release(order.id);
    console.error("Failed to create CHIP purchase", error);
    return NextResponse.json(
      { error: "We could not start the payment. Please try again." },
      { status: 502 },
    );
  }
}
