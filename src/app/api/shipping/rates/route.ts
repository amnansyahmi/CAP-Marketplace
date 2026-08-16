import { NextResponse } from "next/server";

import { deliveryOptions } from "@/lib/delivery";
import { productById } from "@/lib/products";
import { priceMap } from "@/lib/pricing";
import { round } from "@/lib/shipping";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { normaliseBagLines, readJsonBody } from "@/lib/request-limits";

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
  // Each call can reach the courier API. Generous, because checkout refetches
  // legitimately as the customer edits their address.
  const gate = rateLimit(`rates:${clientKey(request)}`, { limit: 60, windowMs: 5 * 60 * 1000 });
  if (!gate.allowed) return tooManyRequests(gate.retryInMs);

  const read = await readJsonBody<{
    state?: string;
    postcode?: string;
    items?: { productId?: string; quantity?: number }[];
  }>(request);
  if (!read.ok) return read.response;
  const body = read.body;

  const state = String(body.state ?? "").trim();
  const postcode = String(body.postcode ?? "").trim();
  if (!state) return NextResponse.json({ options: [], reason: "no_state" });

  const prices = await priceMap();
  const lines: { productId: string; quantity: number }[] = [];
  let subtotal = 0;
  for (const line of normaliseBagLines(body.items ?? [])) {
    const product = productById(line.productId);
    if (!product) continue;
    lines.push({ productId: product.id, quantity: line.quantity });
    // The subtotal decides whether delivery is free, so it is priced from the
    // shop's record rather than from whatever the browser thinks things cost.
    subtotal += (prices.get(product.id) ?? product.price) * line.quantity;
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
