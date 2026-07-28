/**
 * Affiliate portal sessions.
 *
 * Same shape as the admin session — a signed value rather than a stored one, so
 * there is no session table — with one important difference: an affiliate
 * session names *who* it is for. The admin session only has to answer "is this
 * the shop owner"; this one has to answer "which affiliate", because the whole
 * point is that each sees only their own sales.
 *
 * That makes the code part of the signed payload. A visitor who edits the code
 * in their cookie to somebody else's invalidates the signature and is signed
 * out, rather than being shown another affiliate's earnings.
 *
 * Required environment variable:
 *   AFFILIATE_SESSION_SECRET – random string, separate from the admin's
 *
 * Separate on purpose: the two audiences are different, and a leaked affiliate
 * secret must not be forgeable into an admin session.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const AFFILIATE_COOKIE = "chef_ammar_affiliate";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // a month; they check in rarely

export type AffiliateAuthConfig = { enabled: true; secret: string } | { enabled: false; reason: string };

export function affiliateAuthConfig(): AffiliateAuthConfig {
  const secret = process.env.AFFILIATE_SESSION_SECRET;
  if (!secret) return { enabled: false, reason: "AFFILIATE_SESSION_SECRET is not set" };
  if (secret.length < 16) {
    return { enabled: false, reason: "AFFILIATE_SESSION_SECRET must be at least 16 characters" };
  }
  return { enabled: true, secret };
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
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

/** Session token: `<code>.<expiry>.<nonce>.<hmac>`. */
export function issueSession(code: string, now = Date.now()): { value: string; expiresAt: Date } | null {
  const config = affiliateAuthConfig();
  if (!config.enabled) return null;
  // A dot would split the token into the wrong fields on the way back.
  if (!/^[A-Z0-9-]{3,24}$/.test(code)) return null;

  const expiresAt = now + SESSION_TTL_MS;
  const nonce = randomBytes(9).toString("base64url");
  const payload = `${code}.${expiresAt}.${nonce}`;
  return { value: `${payload}.${sign(payload, config.secret)}`, expiresAt: new Date(expiresAt) };
}

/** The affiliate code this token is valid for, or null. */
export function readSession(token: string | undefined, now = Date.now()): string | null {
  const config = affiliateAuthConfig();
  if (!config.enabled || !token) return null;

  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [code, expiry, nonce, signature] = parts;

  if (!safeEqual(signature, sign(`${code}.${expiry}.${nonce}`, config.secret))) return null;

  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  return code;
}

/**
 * Sign-in throttling, keyed by client address.
 *
 * In-process, so it does not hold across instances — it raises the cost of
 * guessing rather than removing it. Shared shape with the admin's, kept
 * separate so a locked-out affiliate cannot lock the shop owner out too.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;

export function throttle(key: string, now = Date.now()): { allowed: boolean; retryInMs: number } {
  const record = attempts.get(key);
  if (!record || record.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryInMs: 0 };
  }
  record.count += 1;
  if (record.count > MAX_ATTEMPTS) return { allowed: false, retryInMs: record.resetAt - now };
  return { allowed: true, retryInMs: 0 };
}

export function clearThrottle(key: string) {
  attempts.delete(key);
}

/** Test seam — resets the throttle table between cases. */
export function resetThrottleForTests() {
  attempts.clear();
}
