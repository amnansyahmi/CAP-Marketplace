/**
 * Affiliates and commission.
 *
 * Two rules drive the design, both of them about not paying the wrong amount:
 *
 * 1. **Commission is calculated on the subtotal, never the total.** Delivery is
 *    a cost passed through to a courier, not margin — paying a percentage of it
 *    would mean paying affiliates out of postage.
 * 2. **The rate is snapshotted onto the order.** Commission is computed once,
 *    at order time, from the rate then in force. Raising or lowering an
 *    affiliate's rate later changes future orders only; it must never rewrite
 *    what has already been earned or paid.
 */

import { randomUUID } from "node:crypto";

import { getDb } from "@/lib/db/client";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/affiliate/credentials";
import { round } from "@/lib/shipping";

export type Affiliate = {
  id: string;
  code: string;
  name: string;
  email: string;
  phone?: string;
  /** Fraction of subtotal, e.g. 0.1 for 10%. */
  commissionRate: number;
  active: boolean;
  notes?: string;
  createdAt: string;
};

export type NewAffiliate = {
  code: string;
  name: string;
  email: string;
  phone?: string;
  commissionRate: number;
  notes?: string;
};

/** Per-affiliate totals for the admin. */
export type AffiliateSummary = {
  affiliate: Affiliate;
  /** Paid orders attributed to them. */
  orderCount: number;
  /** Subtotal of those orders — what commission is calculated from. */
  salesSubtotal: number;
  /** Earned and awaiting payout. */
  commissionOwed: number;
  /** Already paid out. */
  commissionPaid: number;
};

export type CommissionStatus = "none" | "pending" | "paid" | "void";

/**
 * Referral codes come from a URL, so they are normalised and bounded before
 * they reach a query. Returns null for anything that could not be a code.
 */
export function normaliseCode(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{1,22}[A-Z0-9]$/.test(code)) return null;
  return code;
}

/**
 * Commission on an order, rounded to sen.
 *
 * Takes the subtotal specifically — passing the total here would quietly pay
 * commission on delivery.
 */
export function commissionFor(subtotal: number, rate: number): number {
  return round(subtotal * rate);
}

type AffiliateRow = {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string | null;
  commission_rate: string;
  active: boolean;
  notes: string | null;
  created_at: Date | string;
};

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

function rowToAffiliate(row: AffiliateRow): Affiliate {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    email: row.email,
    phone: row.phone ?? undefined,
    commissionRate: Number(row.commission_rate),
    active: row.active,
    notes: row.notes ?? undefined,
    createdAt: iso(row.created_at),
  };
}

export interface AffiliateStore {
  create(input: NewAffiliate): Promise<Affiliate>;
  /** Only returns an active affiliate — an inactive code earns nothing. */
  activeByCode(code: string): Promise<Affiliate | undefined>;
  byCode(code: string): Promise<Affiliate | undefined>;
  list(): Promise<Affiliate[]>;
  setActive(id: string, active: boolean): Promise<Affiliate | undefined>;
  setRate(id: string, commissionRate: number): Promise<Affiliate | undefined>;
  summaries(): Promise<AffiliateSummary[]>;
  summary(code: string): Promise<AffiliateSummary | undefined>;
  /** Marks every earned, unpaid commission for this affiliate as paid out. */
  payOut(affiliateId: string): Promise<{ orders: number; amount: number }>;

  // --- portal sign-in ------------------------------------------------------
  /** Replaces the affiliate's password. Rejects one that is too short. */
  setPassword(id: string, password: string): Promise<boolean>;
  /** Removes the password, which stops the affiliate signing in at all. */
  clearPassword(id: string): Promise<boolean>;
  /**
   * The affiliate for these credentials, or undefined.
   *
   * Deliberately gives one answer for "no such code", "wrong password" and
   * "deactivated": which of the three it was is useful to someone guessing and
   * to nobody else.
   */
  authenticate(code: string, password: string): Promise<Affiliate | undefined>;
  /** Whether a password has been set, for the admin to show state. */
  hasPassword(id: string): Promise<boolean>;
}

class PostgresAffiliateStore implements AffiliateStore {
  async create(input: NewAffiliate): Promise<Affiliate> {
    const db = await getDb();
    const code = normaliseCode(input.code);
    if (!code) throw new Error("Referral code must be 3-24 letters, digits or dashes.");
    if (!(input.commissionRate >= 0 && input.commissionRate <= 1)) {
      throw new Error("Commission rate must be between 0 and 1.");
    }

    const rows = await db.query<AffiliateRow>(
      `INSERT INTO affiliates (id, code, name, email, phone, commission_rate, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        randomUUID(),
        code,
        input.name.trim(),
        input.email.trim().toLowerCase(),
        input.phone?.trim() || null,
        input.commissionRate,
        input.notes?.trim() || null,
      ],
    );
    return rowToAffiliate(rows.rows[0]);
  }

  async activeByCode(code: string) {
    const normalised = normaliseCode(code);
    if (!normalised) return undefined;
    const db = await getDb();
    const rows = await db.query<AffiliateRow>(
      `SELECT * FROM affiliates WHERE code = $1 AND active = true`,
      [normalised],
    );
    return rows.rows[0] ? rowToAffiliate(rows.rows[0]) : undefined;
  }

  async byCode(code: string) {
    const normalised = normaliseCode(code);
    if (!normalised) return undefined;
    const db = await getDb();
    const rows = await db.query<AffiliateRow>(`SELECT * FROM affiliates WHERE code = $1`, [normalised]);
    return rows.rows[0] ? rowToAffiliate(rows.rows[0]) : undefined;
  }

  async list() {
    const db = await getDb();
    const rows = await db.query<AffiliateRow>(`SELECT * FROM affiliates ORDER BY created_at DESC`);
    return rows.rows.map(rowToAffiliate);
  }

  async setActive(id: string, active: boolean) {
    const db = await getDb();
    const rows = await db.query<AffiliateRow>(
      `UPDATE affiliates SET active = $2 WHERE id = $1 RETURNING *`,
      [id, active],
    );
    return rows.rows[0] ? rowToAffiliate(rows.rows[0]) : undefined;
  }

  async setRate(id: string, commissionRate: number) {
    if (!(commissionRate >= 0 && commissionRate <= 1)) {
      throw new Error("Commission rate must be between 0 and 1.");
    }
    const db = await getDb();
    // Only affects orders placed from now on: existing orders carry their own
    // snapshotted rate and amount.
    const rows = await db.query<AffiliateRow>(
      `UPDATE affiliates SET commission_rate = $2 WHERE id = $1 RETURNING *`,
      [id, commissionRate],
    );
    return rows.rows[0] ? rowToAffiliate(rows.rows[0]) : undefined;
  }

  private async totalsFor(ids: string[]) {
    const db = await getDb();
    if (ids.length === 0) return new Map<string, Omit<AffiliateSummary, "affiliate">>();

    // Only paid orders count. A pending or failed order has earned nothing.
    const rows = await db.query<{
      affiliate_id: string;
      order_count: string;
      sales_subtotal: string;
      owed: string;
      paid: string;
    }>(
      `SELECT affiliate_id,
              count(*) FILTER (WHERE status = 'paid')::text AS order_count,
              COALESCE(SUM(subtotal) FILTER (WHERE status = 'paid'), 0)::text AS sales_subtotal,
              -- "Owed" must mean earned, so this matches payOut exactly:
              -- commission is pending AND the order was actually paid. Filtering
              -- on commission_status alone would show commission on orders that
              -- were never completed, overstating what the business owes.
              COALESCE(SUM(commission_amount) FILTER (
                WHERE commission_status = 'pending' AND status = 'paid'
              ), 0)::text AS owed,
              COALESCE(SUM(commission_amount) FILTER (WHERE commission_status = 'paid'), 0)::text AS paid
         FROM orders
        WHERE affiliate_id = ANY($1)
        GROUP BY affiliate_id`,
      [ids],
    );

    const map = new Map<string, Omit<AffiliateSummary, "affiliate">>();
    for (const r of rows.rows) {
      map.set(r.affiliate_id, {
        orderCount: Number(r.order_count),
        salesSubtotal: Number(r.sales_subtotal),
        commissionOwed: Number(r.owed),
        commissionPaid: Number(r.paid),
      });
    }
    return map;
  }

  async summaries() {
    const affiliates = await this.list();
    const totals = await this.totalsFor(affiliates.map((a) => a.id));
    return affiliates.map((affiliate) => ({
      affiliate,
      orderCount: 0,
      salesSubtotal: 0,
      commissionOwed: 0,
      commissionPaid: 0,
      ...totals.get(affiliate.id),
    }));
  }

  async summary(code: string) {
    const affiliate = await this.byCode(code);
    if (!affiliate) return undefined;
    const totals = await this.totalsFor([affiliate.id]);
    return {
      affiliate,
      orderCount: 0,
      salesSubtotal: 0,
      commissionOwed: 0,
      commissionPaid: 0,
      ...totals.get(affiliate.id),
    };
  }

  async payOut(affiliateId: string) {
    const db = await getDb();
    // `commission_status = 'pending' AND status = 'paid'` in the WHERE clause:
    // only commission that has actually been earned can be paid out, and a
    // second click cannot pay the same commission twice.
    const rows = await db.query<{ commission_amount: string }>(
      `UPDATE orders
          SET commission_status  = 'paid',
              commission_paid_at = now()
        WHERE affiliate_id = $1
          AND commission_status = 'pending'
          AND status = 'paid'
        RETURNING commission_amount`,
      [affiliateId],
    );
    const amount = round(rows.rows.reduce((sum, r) => sum + Number(r.commission_amount), 0));
    return { orders: rows.rows.length, amount };
  }

  async setPassword(id: string, password: string) {
    const problem = passwordProblem(password);
    if (problem) throw new Error(problem);

    const { hash, salt } = await hashPassword(password);
    const db = await getDb();
    const rows = await db.query(
      `UPDATE affiliates
          SET password_hash = $2, password_salt = $3, password_set_at = now()
        WHERE id = $1
       RETURNING id`,
      [id, hash, salt],
    );
    return rows.rows.length === 1;
  }

  async clearPassword(id: string) {
    const db = await getDb();
    const rows = await db.query(
      `UPDATE affiliates
          SET password_hash = NULL, password_salt = NULL, password_set_at = NULL
        WHERE id = $1
       RETURNING id`,
      [id],
    );
    return rows.rows.length === 1;
  }

  async authenticate(code: string, password: string) {
    const normalised = normaliseCode(code);
    if (!normalised) return undefined;

    const db = await getDb();
    const rows = await db.query<AffiliateRow & { password_hash: string | null; password_salt: string | null }>(
      `SELECT * FROM affiliates WHERE code = $1`,
      [normalised],
    );
    const row = rows.rows[0];

    // Hash even when there is no such affiliate, so a missing code does not
    // return measurably faster than a wrong password and become a way to
    // enumerate which codes exist.
    const matches = await verifyPassword(password, {
      hash: row?.password_hash ?? undefined,
      salt: row?.password_salt ?? undefined,
    });

    if (!row || !matches) return undefined;
    // Deactivating an affiliate has to close their portal too, or "deactivated"
    // would only mean "earns nothing" while they still read the sales list.
    if (!row.active) return undefined;
    return rowToAffiliate(row);
  }

  async hasPassword(id: string) {
    const db = await getDb();
    const rows = await db.query<{ set: boolean }>(
      `SELECT (password_hash IS NOT NULL) AS set FROM affiliates WHERE id = $1`,
      [id],
    );
    return rows.rows[0]?.set ?? false;
  }
}

export const affiliateStore: AffiliateStore = new PostgresAffiliateStore();
