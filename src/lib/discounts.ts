/**
 * Discount codes.
 *
 * Two decisions worth naming, because both are about paying the right amount:
 *
 * 1. **The discount comes off the goods subtotal, never delivery.** Postage is
 *    money owed to a courier regardless. A code that ate into it would be the
 *    shop paying part of the delivery out of its own margin without meaning to.
 *
 * 2. **Commission is earned on what the shop actually received.** If a RM 40
 *    bag is discounted to RM 32, the affiliate earns their percentage of
 *    RM 32. Paying on the pre-discount figure is the same error as paying
 *    commission on delivery: money leaving on revenue that never arrived. The
 *    order API takes `subtotalAfterDiscount` for exactly this reason.
 *
 * A redemption is claimed atomically at order time and given back if the
 * payment never completes, so a limited code cannot be over-redeemed by two
 * people checking out together.
 */

import { randomUUID } from "node:crypto";

import { getDb } from "@/lib/db/client";
import { round } from "@/lib/shipping";

export type DiscountKind = "percent" | "fixed";

export type DiscountCode = {
  id: string;
  code: string;
  kind: DiscountKind;
  /** Fraction for `percent` (0.1 = 10%), ringgit for `fixed`. */
  value: number;
  minSubtotal: number;
  maxRedemptions: number | null;
  redeemed: number;
  startsAt?: string;
  expiresAt?: string;
  active: boolean;
  createdAt: string;
};

export type NewDiscountCode = {
  code: string;
  kind: DiscountKind;
  value: number;
  minSubtotal?: number;
  maxRedemptions?: number | null;
  startsAt?: string | null;
  expiresAt?: string | null;
};

export type DiscountCheck =
  | { ok: true; code: string; kind: DiscountKind; amount: number; subtotalAfter: number }
  | { ok: false; reason: string };

type Row = {
  id: string;
  code: string;
  kind: DiscountKind;
  value: string;
  min_subtotal: string;
  max_redemptions: number | null;
  redeemed: number | string;
  starts_at: Date | string | null;
  expires_at: Date | string | null;
  active: boolean;
  created_at: Date | string;
};

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

function rowTo(row: Row): DiscountCode {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    value: Number(row.value),
    minSubtotal: Number(row.min_subtotal),
    maxRedemptions: row.max_redemptions,
    redeemed: Number(row.redeemed),
    startsAt: row.starts_at ? iso(row.starts_at) : undefined,
    expiresAt: row.expires_at ? iso(row.expires_at) : undefined,
    active: row.active,
    createdAt: iso(row.created_at),
  };
}

/** Codes come from a form, so they are normalised and bounded before a query. */
export function normaliseDiscountCode(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{1,22}[A-Z0-9]$/.test(code) ? code : null;
}

/**
 * What this code takes off a given subtotal.
 *
 * Never more than the subtotal itself: a RM 20 fixed discount on a RM 12 bag
 * makes it free, not a refund of RM 8.
 */
export function discountFor(code: Pick<DiscountCode, "kind" | "value">, subtotal: number): number {
  const raw = code.kind === "percent" ? subtotal * code.value : code.value;
  return round(Math.min(Math.max(0, raw), subtotal));
}

export interface DiscountStore {
  create(input: NewDiscountCode): Promise<DiscountCode>;
  list(): Promise<DiscountCode[]>;
  byCode(code: string): Promise<DiscountCode | undefined>;
  setActive(id: string, active: boolean): Promise<DiscountCode | undefined>;
  /** Checks a code without consuming it, for showing the total before checkout. */
  check(code: string, subtotal: number, now?: Date): Promise<DiscountCheck>;
  /**
   * Claims one redemption. Returns the discount, or a reason it was refused.
   *
   * The limit is enforced inside the UPDATE, so two customers redeeming the
   * last use of a code at the same moment cannot both succeed.
   */
  redeem(code: string, subtotal: number): Promise<DiscountCheck>;
  /** Gives a redemption back when the order never completed. */
  release(orderId: string): Promise<boolean>;
  /**
   * Takes the redemption back off the shelf when the order completed after all.
   *
   * The mirror of `release`, for a payment that failed and then succeeded. A
   * code that was actually used has to stay counted, or a limited promotion
   * quietly runs further than it was meant to.
   */
  reclaim(orderId: string): Promise<boolean>;
}

class PostgresDiscountStore implements DiscountStore {
  async create(input: NewDiscountCode): Promise<DiscountCode> {
    const code = normaliseDiscountCode(input.code);
    if (!code) throw new Error("Code must be 3-24 letters, digits or dashes.");
    if (!(input.value > 0)) throw new Error("Value must be greater than zero.");
    if (input.kind === "percent" && input.value > 1) {
      throw new Error("A percentage must be a fraction between 0 and 1.");
    }

    const db = await getDb();
    const rows = await db.query<Row>(
      `INSERT INTO discount_codes
         (id, code, kind, value, min_subtotal, max_redemptions, starts_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz)
       RETURNING *`,
      [
        randomUUID(),
        code,
        input.kind,
        input.value,
        input.minSubtotal ?? 0,
        input.maxRedemptions ?? null,
        input.startsAt ?? null,
        input.expiresAt ?? null,
      ],
    );
    return rowTo(rows.rows[0]);
  }

  async list() {
    const db = await getDb();
    const rows = await db.query<Row>(`SELECT * FROM discount_codes ORDER BY created_at DESC`);
    return rows.rows.map(rowTo);
  }

  async byCode(code: string) {
    const normalised = normaliseDiscountCode(code);
    if (!normalised) return undefined;
    const db = await getDb();
    const rows = await db.query<Row>(`SELECT * FROM discount_codes WHERE code = $1`, [normalised]);
    return rows.rows[0] ? rowTo(rows.rows[0]) : undefined;
  }

  async setActive(id: string, active: boolean) {
    const db = await getDb();
    const rows = await db.query<Row>(
      `UPDATE discount_codes SET active = $2 WHERE id = $1 RETURNING *`,
      [id, active],
    );
    return rows.rows[0] ? rowTo(rows.rows[0]) : undefined;
  }

  async check(code: string, subtotal: number, now = new Date()): Promise<DiscountCheck> {
    const found = await this.byCode(code);
    // One message for "no such code" and "expired", so the form cannot be used
    // to discover which codes exist.
    if (!found || !found.active) return { ok: false, reason: "That code is not valid." };
    if (found.startsAt && new Date(found.startsAt) > now) {
      return { ok: false, reason: "That code is not valid yet." };
    }
    if (found.expiresAt && new Date(found.expiresAt) <= now) {
      return { ok: false, reason: "That code has expired." };
    }
    if (found.maxRedemptions !== null && found.redeemed >= found.maxRedemptions) {
      return { ok: false, reason: "That code has been fully redeemed." };
    }
    if (subtotal < found.minSubtotal) {
      return {
        ok: false,
        reason: `That code needs a subtotal of at least RM ${found.minSubtotal.toFixed(2)}.`,
      };
    }

    const amount = discountFor(found, subtotal);
    return { ok: true, code: found.code, kind: found.kind, amount, subtotalAfter: round(subtotal - amount) };
  }

  async redeem(code: string, subtotal: number): Promise<DiscountCheck> {
    const normalised = normaliseDiscountCode(code);
    if (!normalised) return { ok: false, reason: "That code is not valid." };

    const db = await getDb();
    // Every condition lives in the WHERE clause. Checking in JavaScript first
    // and updating after would let two customers both read "one use left".
    const rows = await db.query<Row>(
      `UPDATE discount_codes
          SET redeemed = redeemed + 1
        WHERE code = $1
          AND active = true
          AND (starts_at IS NULL OR starts_at <= now())
          AND (expires_at IS NULL OR expires_at > now())
          AND (max_redemptions IS NULL OR redeemed < max_redemptions)
          AND min_subtotal <= $2
       RETURNING *`,
      [normalised, subtotal],
    );

    const row = rows.rows[0];
    if (!row) {
      // Fall back to the read-only check purely to produce a useful message.
      const why = await this.check(normalised, subtotal);
      return why.ok ? { ok: false, reason: "That code is not valid." } : why;
    }

    const found = rowTo(row);
    const amount = discountFor(found, subtotal);
    return { ok: true, code: found.code, kind: found.kind, amount, subtotalAfter: round(subtotal - amount) };
  }

  async release(orderId: string): Promise<boolean> {
    const db = await getDb();

    return db.transaction(async (tx) => {
      // Claim first: an order that failed and was then cancelled must not free
      // up two redemptions of a limited code.
      const claimed = await tx.query<{ discount_code: string }>(
        `UPDATE orders SET discount_released = true
          WHERE id = $1 AND discount_code IS NOT NULL AND discount_released = false
          RETURNING discount_code`,
        [orderId],
      );
      const code = claimed.rows[0]?.discount_code;
      if (!code) return false;

      await tx.query(
        `UPDATE discount_codes SET redeemed = GREATEST(0, redeemed - 1) WHERE code = $1`,
        [code],
      );
      return true;
    });
  }

  async reclaim(orderId: string): Promise<boolean> {
    const db = await getDb();

    return db.transaction(async (tx) => {
      // Claim first, exactly as `release` does: two callbacks arriving together
      // must not count the same code twice.
      const claimed = await tx.query<{ discount_code: string }>(
        `UPDATE orders SET discount_released = false
          WHERE id = $1 AND discount_code IS NOT NULL AND discount_released = true
          RETURNING discount_code`,
        [orderId],
      );
      const code = claimed.rows[0]?.discount_code;
      if (!code) return false;

      // Deliberately not checked against `max_redemptions`. The customer used
      // the code and paid; the count is a record of what happened, and a record
      // that refuses to admit the last redemption is simply wrong.
      await tx.query(`UPDATE discount_codes SET redeemed = redeemed + 1 WHERE code = $1`, [code]);
      return true;
    });
  }
}

export const discountStore: DiscountStore = new PostgresDiscountStore();
