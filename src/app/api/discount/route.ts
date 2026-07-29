import { NextResponse } from "next/server";

import { discountStore, normaliseDiscountCode } from "@/lib/discounts";
import { productById } from "@/lib/products";
import { round } from "@/lib/shipping";

/**
 * Checks a code so the checkout can show the new total before submitting.
 *
 * Deliberately does **not** redeem it. A customer looking at their total has
 * not bought anything, and consuming a limited code on a page view would let
 * anyone burn through a promotion without spending a ringgit.
 *
 * The subtotal is recomputed from the catalogue rather than taken from the
 * request, so the quoted discount is the real one — the browser cannot inflate
 * its own bag to clear a minimum-spend threshold.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { code?: string; items?: { productId?: string; quantity?: number }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const code = normaliseDiscountCode(body.code);
  if (!code) return NextResponse.json({ ok: false, reason: "That code is not valid." });

  let subtotal = 0;
  for (const line of body.items ?? []) {
    const product = productById(String(line.productId ?? ""));
    if (!product) continue;
    const quantity = Math.min(99, Math.max(1, Math.floor(Number(line.quantity) || 0)));
    subtotal += product.price * quantity;
  }
  subtotal = round(subtotal);

  const result = await discountStore.check(code, subtotal);
  return NextResponse.json(result);
}
