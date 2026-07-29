/**
 * Who may look at an order.
 *
 * The order page shows a customer's full name, phone number and home address.
 * Before this existed, the only thing standing between a stranger and that
 * information was knowing a six-character reference — which is printed on
 * emails, read out over the phone and pasted into chats.
 *
 * Two ways in, both proving something the reference alone does not:
 *
 * 1. **A signed token** (`?t=`), issued when the order is placed and included
 *    in the link we email. It names the order inside the signature, so it
 *    cannot be moved to a different one.
 * 2. **The buyer's own browser**, which keeps a cookie listing the orders it
 *    placed. This is what makes the flow work straight after checkout and on a
 *    later visit from the same device.
 *
 * Neither is a login. Someone who forwards their confirmation email is sharing
 * their own order, which is theirs to share. The point is that a reference on
 * its own no longer opens anything.
 *
 * Required environment variable:
 *   ORDER_ACCESS_SECRET – signs the tokens. Unset, tokens are refused and only
 *   the buyer's own browser can open the page: a missing secret must never
 *   mean "let everybody in".
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const ORDER_COOKIE = "chef_ammar_orders";
/** How many recent orders one browser remembers. */
const REMEMBERED = 12;

export type OrderAccessConfig = { enabled: true; secret: string } | { enabled: false; reason: string };

export function orderAccessConfig(): OrderAccessConfig {
  const secret = process.env.ORDER_ACCESS_SECRET;
  if (!secret) return { enabled: false, reason: "ORDER_ACCESS_SECRET is not set" };
  if (secret.length < 16) {
    return { enabled: false, reason: "ORDER_ACCESS_SECRET must be at least 16 characters" };
  }
  return { enabled: true, secret };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * A token for this reference, or null when unconfigured.
 *
 * Deliberately has no expiry. A confirmation email is the customer's record of
 * a purchase and may be opened months later; an expiring link would turn that
 * into a dead end for the one person entitled to see it.
 */
export function issueOrderToken(reference: string): string | null {
  const config = orderAccessConfig();
  if (!config.enabled) return null;
  return createHmac("sha256", config.secret).update(`order:${reference}`).digest("base64url");
}

export function verifyOrderToken(reference: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = issueOrderToken(reference);
  if (!expected) return false; // unconfigured: no token is valid
  return safeEqual(token, expected);
}

/** Parses the browser's "orders I placed" cookie. */
export function readOrderCookie(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((r) => r.trim().toUpperCase())
    .filter((r) => /^CA-[0-9A-Z]{6}$/.test(r))
    .slice(0, REMEMBERED);
}

/** Adds a reference to the browser's list, most recent first, without duplicates. */
export function addToOrderCookie(existing: string | undefined, reference: string): string {
  const current = readOrderCookie(existing).filter((r) => r !== reference.toUpperCase());
  return [reference.toUpperCase(), ...current].slice(0, REMEMBERED).join(",");
}

export function cookiePlacedThisOrder(cookieValue: string | undefined, reference: string): boolean {
  return readOrderCookie(cookieValue).includes(reference.toUpperCase());
}
