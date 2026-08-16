/**
 * A shared limiter for the shop's public write endpoints.
 *
 * `/api/orders` creates database rows, reserves stock, redeems discount codes
 * and calls a payment gateway — all without any authentication, because a
 * customer buying something does not have an account. Left open, a script can
 * exhaust a limited discount code, hold every jar in stock in pending
 * reservations, and fill the orders table, without ever paying for anything.
 *
 * **In-process, so it does not hold across instances.** On a single container
 * it is a real limit; spread across several it becomes "N times the limit".
 * That raises the cost of abuse rather than removing it, which is the honest
 * description — put a limit at the edge (Vercel, Cloudflare) as well before the
 * shop is genuinely exposed.
 *
 * Deliberately not a dependency: a fixed window over a Map is a dozen lines,
 * and a limiter that needs Redis to work would be one more thing that has to be
 * up for a customer to buy something.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Stops the Map growing without bound on a long-running process. */
const MAX_TRACKED = 10_000;

export type RateLimitResult = { allowed: true } | { allowed: false; retryInMs: number };

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
  now = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED) sweep(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  existing.count += 1;
  if (existing.count > limit) return { allowed: false, retryInMs: existing.resetAt - now };
  return { allowed: true };
}

/** Drops expired buckets. Cheap, and only runs when the table gets large. */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Everything is still live: forget the oldest rather than grow forever.
  if (buckets.size >= MAX_TRACKED) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [key] of oldest.slice(0, Math.floor(MAX_TRACKED / 4))) buckets.delete(key);
  }
}

/**
 * Best-effort client identity.
 *
 * A forwarded header can be spoofed, so this is not an identity — it is a
 * cost. Behind Vercel the leftmost entry is the real client address.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/** A 429 with the header clients and crawlers actually respect. */
export function tooManyRequests(retryInMs: number): Response {
  const seconds = Math.max(1, Math.ceil(retryInMs / 1000));
  return new Response(
    JSON.stringify({ error: "Too many requests. Please slow down and try again shortly." }),
    {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(seconds) },
    },
  );
}

/** Test seam — clears every bucket between cases. */
export function resetRateLimitsForTests(): void {
  buckets.clear();
}

/**
 * The same fixed window, counted in the database so every instance shares it.
 *
 * The in-process limiter above is the first gate and stays: it costs nothing
 * and turns away the bulk of a naive flood without touching Postgres. This one
 * exists because that limiter resets to empty on every new instance, and a
 * traffic spike is precisely when new instances appear — so the limit a
 * determined script actually meets is "N times the limit", growing with the
 * load it creates. Reserve it for endpoints where being wrong costs money.
 *
 * One statement, so the read and the write cannot be split by a concurrent
 * caller. **Fails open**: if the database is unreachable the limiter allows the
 * request, because refusing every customer is a worse outcome than briefly
 * losing a limit — and every endpoint that calls this needs the database
 * moments later anyway.
 */
export async function sharedRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  try {
    const { getDb } = await import("@/lib/db/client");
    const db = await getDb();
    const rows = await db.query<{ count: number | string; reset_at: Date | string }>(
      `INSERT INTO rate_limits (bucket, count, reset_at)
            VALUES ($1, 1, now() + ($2::bigint * interval '1 millisecond'))
       ON CONFLICT (bucket) DO UPDATE
            SET count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
                reset_at = CASE WHEN rate_limits.reset_at <= now()
                                THEN now() + ($2::bigint * interval '1 millisecond')
                                ELSE rate_limits.reset_at END
         RETURNING count, reset_at`,
      [key, Math.max(1, Math.floor(windowMs))],
    );

    const row = rows.rows[0];
    if (!row) return { allowed: true };

    if (Number(row.count) > limit) {
      const resetAt = row.reset_at instanceof Date ? row.reset_at : new Date(row.reset_at);
      return { allowed: false, retryInMs: Math.max(1000, resetAt.getTime() - Date.now()) };
    }

    // Occasionally, not on every request: the sweep is housekeeping, and making
    // every checkout pay for it would be the limiter costing more than it saves.
    if (Math.random() < 0.01) {
      await db.query(`DELETE FROM rate_limits WHERE reset_at < now() - interval '1 hour'`);
    }

    return { allowed: true };
  } catch (error) {
    console.warn("Shared rate limit unavailable, allowing request", error);
    return { allowed: true };
  }
}
