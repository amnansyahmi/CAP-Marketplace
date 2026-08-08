/**
 * Newsletter subscribers.
 *
 * The footer form used to do nothing at all — it accepted an address, appeared
 * to succeed, and threw it away. That is worse than not having the form: the
 * visitor believes they will hear from the shop, and they never will.
 *
 * Two rules:
 *
 * 1. **Unsubscribing is permanent until they say otherwise.** Opting out sets a
 *    timestamp rather than deleting the row. Deleting would mean the next
 *    address they type re-creates the record and the shop starts emailing
 *    someone who asked it to stop.
 * 2. **Signing up twice is not an error.** People forget. A repeat sign-up is
 *    silently the same as the first, and re-subscribing after opting out is
 *    allowed — that is them changing their mind, which is theirs to do.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { getDb } from "@/lib/db/client";

export type Subscriber = {
  email: string;
  subscribedAt: string;
  unsubscribedAt?: string;
  source?: string;
};

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/**
 * Good enough to catch a typo, not a validator.
 *
 * Anything stricter rejects real addresses — the only true test of an address
 * is sending to it.
 */
export function normaliseEmail(raw: string | undefined | null): string | null {
  const email = (raw ?? "").trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

export type SubscribeResult = { ok: true; alreadySubscribed: boolean } | { ok: false; reason: string };

export async function subscribe(rawEmail: string, source = "footer"): Promise<SubscribeResult> {
  const email = normaliseEmail(rawEmail);
  if (!email) return { ok: false, reason: "That does not look like an email address." };

  const db = await getDb();
  // One statement, so two submissions racing cannot both insert. Re-subscribing
  // clears the opt-out, because that is the person changing their mind.
  const rows = await db.query<{ existed: boolean }>(
    `INSERT INTO subscribers (email, source)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE
       SET unsubscribed_at = NULL
     RETURNING (subscribers.subscribed_at < now() - interval '1 second') AS existed`,
    [email, source],
  );

  return { ok: true, alreadySubscribed: rows.rows[0]?.existed ?? false };
}

export async function unsubscribe(rawEmail: string): Promise<boolean> {
  const email = normaliseEmail(rawEmail);
  if (!email) return false;

  const db = await getDb();
  const rows = await db.query(
    `UPDATE subscribers SET unsubscribed_at = now()
      WHERE email = $1 AND unsubscribed_at IS NULL
      RETURNING email`,
    [email],
  );
  return rows.rows.length === 1;
}

export async function listSubscribers({ limit = 200 } = {}): Promise<{
  subscribers: Subscriber[];
  active: number;
  total: number;
}> {
  const db = await getDb();

  const rows = await db.query<{
    email: string;
    subscribed_at: Date | string;
    unsubscribed_at: Date | string | null;
    source: string | null;
  }>(
    `SELECT email, subscribed_at, unsubscribed_at, source
       FROM subscribers
      ORDER BY subscribed_at DESC
      LIMIT $1`,
    [Math.min(1000, Math.max(1, limit))],
  );

  const counts = await db.query<{ active: string; total: string }>(
    `SELECT count(*) FILTER (WHERE unsubscribed_at IS NULL)::text AS active,
            count(*)::text AS total
       FROM subscribers`,
  );

  return {
    subscribers: rows.rows.map((row) => ({
      email: row.email,
      subscribedAt: iso(row.subscribed_at),
      unsubscribedAt: row.unsubscribed_at ? iso(row.unsubscribed_at) : undefined,
      source: row.source ?? undefined,
    })),
    active: Number(counts.rows[0]?.active ?? 0),
    total: Number(counts.rows[0]?.total ?? 0),
  };
}

/**
 * A signed one-click unsubscribe token.
 *
 * Signed rather than a raw address in the URL: without it, anyone could
 * unsubscribe anyone else by editing the link, and every marketing email would
 * hand out that ability.
 *
 * Falls back to `ORDER_ACCESS_SECRET` because it is the same class of secret
 * and one fewer variable to forget. Unset, unsubscribe links are not issued and
 * the footer says to reply to any email instead — silently issuing links that
 * cannot work would be worse.
 */
function secret(): string | null {
  return process.env.NEWSLETTER_SECRET || process.env.ORDER_ACCESS_SECRET || null;
}

export function unsubscribeToken(email: string): string | null {
  const key = secret();
  const address = normaliseEmail(email);
  if (!key || !address) return null;
  return createHmac("sha256", key).update(`unsubscribe:${address}`).digest("base64url");
}

export function verifyUnsubscribeToken(email: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = unsubscribeToken(email);
  if (!expected) return false;

  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}
