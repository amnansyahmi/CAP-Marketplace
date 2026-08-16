/**
 * Where Bayarcash hands the payer back.
 *
 * Bayarcash has one return URL for every outcome and reports which one it was
 * in the redirect itself, so the shop needs a step in between to check that
 * report before showing anything based on it. Nothing here writes to an order:
 * the money is settled by the server-to-server callback alone, and this route
 * only decides whether the customer lands on "we are waiting" or "that did not
 * go through".
 *
 * The order reference and access token travel as query parameters we put on the
 * return URL ourselves, because the customer may well come back in a different
 * tab or app where only the URL travels with them.
 */

import { NextResponse } from "next/server";

import { parseCallbackBody, statusFromCode, verifyCallback } from "@/lib/payments/bayarcash";

export const dynamic = "force-dynamic";

/** Our own reference format. Anything else must never reach a redirect target. */
const REFERENCE = /^CA-[0-9A-Z]{6}$/;
/** `issueOrderToken` returns base64url; length-bounded so a URL cannot be stuffed. */
const TOKEN = /^[A-Za-z0-9_-]{16,200}$/;

function redirectFor(request: Request, data: Record<string, string>) {
  const url = new URL(request.url);
  const reference = (url.searchParams.get("reference") ?? "").toUpperCase();
  const token = url.searchParams.get("t") ?? "";

  // Without a valid reference there is no order page to go to. The lookup page
  // is a dead end rather than a wrong one.
  if (!REFERENCE.test(reference)) {
    return NextResponse.redirect(new URL("/orders/find", url.origin), 303);
  }

  const target = new URL(`/orders/${reference}`, url.origin);
  if (TOKEN.test(token)) target.searchParams.set("t", token);

  // Only an authentic redirect is allowed to say a payment failed. An
  // unverifiable one falls through to the order page, which shows what the
  // database actually knows.
  if (verifyCallback(data, "return")) {
    const status = statusFromCode(data.status);
    if (status === "failed" || status === "cancelled") {
      target.searchParams.set("payment", "failed");
    }
  }

  return NextResponse.redirect(target, 303);
}

/** API v3 returns the payer by GET, with the result in the query string. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  return redirectFor(request, Object.fromEntries(url.searchParams));
}

/** API v2 posts the same fields instead. Accepted so a v2 portal still lands. */
export async function POST(request: Request) {
  const raw = await request.text();
  return redirectFor(request, parseCallbackBody(raw, request.headers) ?? {});
}
