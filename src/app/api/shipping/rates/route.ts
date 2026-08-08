import { NextResponse } from "next/server";

import { deliveryOptions } from "@/lib/delivery";
import { productById } from "@/lib/products";
import { round } from "@/lib/shipping";

/**
 * Courier options for a bag going to a destination.
 *
 * The subtotal is recomputed from the catalogue rather than taken from the
 * request, for the same reason the order API rebuilds every line: a figure that
 * arrives from a browser decides whether free delivery applies, and that is not
 * a decision a client gets to make.
 *
 * Always answers with at least one option for a deliverable address — the flat
 * zone rate stands in whenever the courier API is unreachable, because a
 * postage quote is not worth losing a sale over.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { state?: string; postcode?: string; items?: { productId?: string; quantity?: number }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const state = String(body.state ?? "").trim();
  const postcode = String(body.postcode ?? "").trim();
  if (!state) return NextResponse.json({ options: [], reason: "no_state" });

  const lines: { productId: string; quantity: number }[] = [];
  let subtotal = 0;
  for (const line of body.items ?? []) {
    const product = productById(String(line.productId ?? ""));
    if (!product) continue;
    const quantity = Math.min(99, Math.max(1, Math.floor(Number(line.quantity) || 0)));
    lines.push({ productId: product.id, quantity });
    subtotal += product.price * quantity;
  }
  subtotal = round(subtotal);

  const quote = await deliveryOptions(lines, { postcode, state }, subtotal);
  if (!quote) return NextResponse.json({ options: [], reason: "undeliverable" });

  return NextResponse.json({
    // `cost` is the shop's business, not the customer's — only what they pay
    // and what they are choosing between goes out here.
    options: quote.options.map((option) => ({
      id: option.id,
      courierName: option.courierName,
      serviceName: option.serviceName,
      price: option.price,
      deliveryEstimate: option.deliveryEstimate,
      fallback: option.fallback,
    })),
    source: quote.source,
    free: quote.free,
    amountToFree: quote.amountToFree,
    zoneLabel: quote.zoneLabel,
  });
}
