import { NextResponse, type NextRequest } from "next/server";

/**
 * Captures a referral code from `?ref=CODE` into a cookie.
 *
 * Done in middleware so it works on the statically generated pages too —
 * reading a search param inside those components would force them to render
 * per-request for every visitor, referred or not.
 *
 * The cookie records the *claim* only. Nothing is trusted here: the order API
 * looks the code up and ignores it unless it matches an active affiliate.
 */

export const REFERRAL_COOKIE = "chef_ammar_ref";
const WINDOW_DAYS = 30;

/** Same shape the affiliate store enforces; kept inline as middleware runs on the edge runtime. */
const CODE = /^[A-Za-z0-9][A-Za-z0-9-]{1,22}[A-Za-z0-9]$/;

export function middleware(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("ref");
  if (!raw || !CODE.test(raw)) return NextResponse.next();

  const response = NextResponse.next();
  response.cookies.set(REFERRAL_COOKIE, raw.toUpperCase(), {
    maxAge: WINDOW_DAYS * 24 * 60 * 60,
    sameSite: "lax",
    path: "/",
    // Deliberately readable by JavaScript: it is not a credential, and the
    // storefront shows who referred the visitor.
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export const config = {
  // Storefront only. The admin area and API do not carry referral links, and
  // static assets should not pay for this.
  matcher: ["/", "/products/:path*", "/checkout"],
};
