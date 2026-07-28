/**
 * Partner API authentication.
 *
 * A separate credential from the admin password on purpose: the central
 * dashboard is a machine consumer with read-only access to sales figures, and
 * should never hold a key that also grants the human admin UI. Rotating one
 * must not force rotating the other.
 *
 *   PARTNER_API_KEY  – bearer token issued to the partner dashboard
 *
 * Unset means the API is disabled, not open.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export type PartnerAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Compares by digest so the comparison is constant-length regardless of the
 * supplied key, and constant-time within that length.
 */
function keysMatch(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function authenticatePartner(request: Request): PartnerAuthResult {
  const expected = process.env.PARTNER_API_KEY;

  if (!expected || expected.length < 24) {
    // Fails closed. A short or missing key disables the endpoint rather than
    // leaving sales data reachable.
    return {
      ok: false,
      status: 503,
      error: "Partner API is not configured on this environment.",
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  // Also accept X-API-Key, since some dashboards cannot set Authorization.
  const supplied = match?.[1]?.trim() || request.headers.get("x-api-key")?.trim();

  if (!supplied || !keysMatch(supplied, expected)) {
    return { ok: false, status: 401, error: "Invalid or missing API key." };
  }

  return { ok: true };
}
