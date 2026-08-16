/**
 * Bounds on what an unauthenticated request may make the shop do.
 *
 * Validation answers "is this well formed". This answers a different question:
 * "how much work can one request ask for". A bag with ten thousand lines passes
 * every rule in `validateCheckout` — every line names a real product and a
 * sensible quantity — and still turns one HTTP request into ten thousand
 * catalogue lookups and ten thousand row inserts. The size of the ask has to be
 * capped separately from its shape.
 */

import { NextResponse } from "next/server";

/**
 * A checkout body is a few hundred bytes of address and a short bag. 16 KB is
 * roughly fifty times the largest honest request and still small enough that
 * buffering it costs nothing.
 */
export const MAX_BODY_BYTES = 16 * 1024;

/** Distinct lines in one bag. The catalogue is small; this is already generous. */
export const MAX_ITEM_LINES = 20;

/** Jars in one order, across every line. Beyond this it is a wholesale enquiry. */
export const MAX_UNITS_PER_ORDER = 200;

/** Per line, matching what the storefront's quantity control allows. */
export const MAX_UNITS_PER_LINE = 99;

export type JsonBody<T> = { ok: true; body: T } | { ok: false; response: Response };

/**
 * Reads a JSON body, refusing anything oversized.
 *
 * `content-length` is checked first so an obvious flood is rejected without
 * reading it, and the decoded text is checked again because that header is
 * absent on a chunked request and is not a promise in any case.
 */
export async function readJsonBody<T>(request: Request, maxBytes = MAX_BODY_BYTES): Promise<JsonBody<T>> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, response: tooLarge() };

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: malformed() };
  }
  if (Buffer.byteLength(raw, "utf8") > maxBytes) return { ok: false, response: tooLarge() };

  try {
    return { ok: true, body: JSON.parse(raw) as T };
  } catch {
    return { ok: false, response: malformed() };
  }
}

function tooLarge() {
  return NextResponse.json({ error: "Request is too large." }, { status: 413 });
}

function malformed() {
  return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
}

/**
 * Collapses a bag into one line per product, with every quantity bounded.
 *
 * Duplicate lines are the loophole the per-line cap alone leaves open: fifty
 * copies of the same product at 99 each is 4,950 jars through a control that
 * looks like it stops at 99. Merging first means the cap applies to what was
 * actually ordered.
 */
export function normaliseBagLines(
  lines: { productId?: unknown; quantity?: unknown }[],
): { productId: string; quantity: number }[] {
  const merged = new Map<string, number>();
  for (const line of lines) {
    const productId = String(line?.productId ?? "");
    if (!productId) continue;
    const quantity = Math.floor(Number(line?.quantity) || 0);
    if (quantity < 1) continue;
    merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  }

  let remaining = MAX_UNITS_PER_ORDER;
  const out: { productId: string; quantity: number }[] = [];
  for (const [productId, quantity] of merged) {
    if (out.length >= MAX_ITEM_LINES || remaining <= 0) break;
    const bounded = Math.min(quantity, MAX_UNITS_PER_LINE, remaining);
    remaining -= bounded;
    out.push({ productId, quantity: bounded });
  }
  return out;
}
