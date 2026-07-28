/**
 * Admin authentication.
 *
 * The admin area lists customers' names, phone numbers and home addresses, so
 * the guiding rule here is **fail closed**: if the environment is not
 * configured, the admin area is disabled outright rather than left open. A
 * missing password must never mean "no password required".
 *
 * A single shared password is enough for one shop owner. If more than one
 * person ever needs access, replace this with real accounts rather than
 * sharing the secret.
 *
 * Required environment variables:
 *   ADMIN_PASSWORD        – the password
 *   ADMIN_SESSION_SECRET  – random string used to sign the session cookie
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "chef_ammar_admin";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // a working day

export type AdminConfig =
  | { enabled: true; password: string; secret: string }
  | { enabled: false; reason: string };

export function adminConfig(): AdminConfig {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SESSION_SECRET;

  if (!password || !secret) {
    const missing = [!password && "ADMIN_PASSWORD", !secret && "ADMIN_SESSION_SECRET"]
      .filter(Boolean)
      .join(" and ");
    return { enabled: false, reason: `${missing} is not set` };
  }
  if (password.length < 12) {
    return { enabled: false, reason: "ADMIN_PASSWORD must be at least 12 characters" };
  }
  return { enabled: true, password, secret };
}

/** Compares without leaking length or content through timing. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // Still do a comparison so the failure takes similar time.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function verifyPassword(candidate: string): boolean {
  const config = adminConfig();
  if (!config.enabled) return false;
  return safeEqual(candidate, config.password);
}

/**
 * Session token: `<expiry>.<nonce>.<hmac>`.
 *
 * Signed rather than stored, so there is no session table to keep. The nonce
 * makes two tokens issued in the same millisecond differ. Nothing secret is
 * carried in the value itself.
 */
export function issueSession(now = Date.now()): { value: string; expiresAt: Date } | null {
  const config = adminConfig();
  if (!config.enabled) return null;

  const expiresAt = now + SESSION_TTL_MS;
  const nonce = randomBytes(9).toString("base64url");
  const payload = `${expiresAt}.${nonce}`;
  const signature = sign(payload, config.secret);
  return { value: `${payload}.${signature}`, expiresAt: new Date(expiresAt) };
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifySession(token: string | undefined, now = Date.now()): boolean {
  const config = adminConfig();
  // Disabled admin means no session is ever valid, even a well-formed one.
  if (!config.enabled || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiry, nonce, signature] = parts;

  const expected = sign(`${expiry}.${nonce}`, config.secret);
  if (!safeEqual(signature, expected)) return false;

  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;

  return true;
}

/**
 * Login throttling, keyed by client address.
 *
 * In-process, so it does not hold across instances — it raises the cost of
 * guessing rather than eliminating it. Put a rate limit at the edge too if the
 * admin area is exposed to the internet.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

export function throttle(key: string, now = Date.now()): { allowed: boolean; retryInMs: number } {
  const record = attempts.get(key);
  if (!record || record.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryInMs: 0 };
  }
  record.count += 1;
  if (record.count > MAX_ATTEMPTS) {
    return { allowed: false, retryInMs: record.resetAt - now };
  }
  return { allowed: true, retryInMs: 0 };
}

export function clearThrottle(key: string) {
  attempts.delete(key);
}

/** Test seam — resets the throttle table between cases. */
export function resetThrottleForTests() {
  attempts.clear();
}
