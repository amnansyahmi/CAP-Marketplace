/**
 * Order model and persistence.
 *
 * Backed by Postgres — see `src/lib/db/client.ts` for driver selection.
 *
 * The interface is deliberately narrow. An earlier version exposed a generic
 * `update(id, patch)`, which forced callers to read an order, decide in
 * JavaScript whether a transition was allowed, then write it back. That
 * read-then-write is a race: two gateway callbacks arriving together can both
 * read `pending_payment` and both believe they may proceed. Status changes now
 * go through `setStatus`, which enforces the rule inside the UPDATE.
 */

import { randomUUID } from "node:crypto";

import { getDb } from "@/lib/db/client";

export type OrderStatus = "pending_payment" | "paid" | "failed" | "cancelled";

/**
 * Where the parcel is. Kept separate from payment status because the two are
 * orthogonal — an order is paid or not, and a paid order then moves through
 * packing and shipping.
 */
export type Fulfilment = "unfulfilled" | "packed" | "shipped" | "delivered";

export const FULFILMENT_STEPS: Fulfilment[] = ["unfulfilled", "packed", "shipped", "delivered"];

export type OrderItem = {
  productId: string;
  name: string;
  /** Unit price at the time of purchase, in ringgit. */
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type Customer = { fullName: string; email: string; phone: string };

export type DeliveryAddress = {
  line1: string;
  line2?: string;
  postcode: string;
  city: string;
  state: string;
};

export type Order = {
  id: string;
  /** Short human-facing code shown to the customer and used in URLs. */
  reference: string;
  status: OrderStatus;
  items: OrderItem[];
  customer: Customer;
  address: DeliveryAddress;
  notes?: string;
  subtotal: number;
  shipping: number;
  total: number;
  currency: "MYR";
  paymentId?: string;
  paymentUrl?: string;
  createdAt: string;
  paidAt?: string;
  fulfilment: Fulfilment;
  trackingNumber?: string;
  fulfilmentUpdatedAt?: string;
};

/** A new order before it has an id or reference — the store assigns both. */
export type NewOrder = Omit<
  Order,
  "id" | "reference" | "createdAt" | "status" | "fulfilment" | "fulfilmentUpdatedAt"
> & {
  status?: OrderStatus;
};

export interface OrderStore {
  create(order: NewOrder): Promise<Order>;
  byReference(reference: string): Promise<Order | undefined>;
  byPaymentId(paymentId: string): Promise<Order | undefined>;
  /** Records the gateway payment, optionally settling the order in the same write. */
  attachPayment(
    id: string,
    payment: { paymentId: string; paymentUrl: string; markPaid?: boolean },
  ): Promise<Order | undefined>;
  /** Atomic status change. Returns undefined when the change was refused. */
  setStatus(id: string, status: OrderStatus): Promise<Order | undefined>;

  // --- admin ---------------------------------------------------------------
  list(filter?: OrderFilter): Promise<{ orders: Order[]; total: number }>;
  stats(): Promise<OrderStats>;
  /** Only a paid order can be fulfilled. Returns undefined when refused. */
  setFulfilment(
    id: string,
    fulfilment: Fulfilment,
    trackingNumber?: string | null,
  ): Promise<Order | undefined>;
}

export type OrderFilter = {
  status?: OrderStatus;
  fulfilment?: Fulfilment;
  /** Matches an order reference or customer email. */
  search?: string;
  limit?: number;
  offset?: number;
};

export type OrderStats = {
  /** Revenue from settled orders only. */
  revenue: number;
  paidCount: number;
  pendingCount: number;
  failedCount: number;
  /** Paid orders not yet handed to the courier. */
  awaitingFulfilment: number;
};

/** e.g. CA-7F3K9Q — short enough to read down the phone. */
export function newOrderReference() {
  const alphabet = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O, to avoid misreads
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `CA-${out}`;
}

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = "23505";

type OrderRow = {
  id: string;
  reference: string;
  status: OrderStatus;
  customer_full_name: string;
  customer_email: string;
  customer_phone: string;
  address_line1: string;
  address_line2: string | null;
  address_postcode: string;
  address_city: string;
  address_state: string;
  notes: string | null;
  fulfilment: Fulfilment;
  tracking_number: string | null;
  fulfilment_updated_at: Date | string | null;
  subtotal: string;
  shipping: string;
  total: string;
  currency: string;
  payment_id: string | null;
  payment_url: string | null;
  created_at: Date | string;
  paid_at: Date | string | null;
};

type ItemRow = {
  product_id: string;
  name: string;
  unit_price: string;
  quantity: number;
  line_total: string;
};

/**
 * Postgres returns `numeric` as a string to avoid the precision loss that
 * float conversion would cause. The database stays the exact record; these
 * numbers are for display and arithmetic in the app.
 */
const amount = (value: string) => Number(value);
const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

function rowToOrder(row: OrderRow, items: ItemRow[]): Order {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    items: items.map((i) => ({
      productId: i.product_id,
      name: i.name,
      unitPrice: amount(i.unit_price),
      quantity: i.quantity,
      lineTotal: amount(i.line_total),
    })),
    customer: {
      fullName: row.customer_full_name,
      email: row.customer_email,
      phone: row.customer_phone,
    },
    address: {
      line1: row.address_line1,
      line2: row.address_line2 ?? undefined,
      postcode: row.address_postcode,
      city: row.address_city,
      state: row.address_state,
    },
    notes: row.notes ?? undefined,
    subtotal: amount(row.subtotal),
    shipping: amount(row.shipping),
    total: amount(row.total),
    currency: row.currency as "MYR",
    paymentId: row.payment_id ?? undefined,
    paymentUrl: row.payment_url ?? undefined,
    createdAt: iso(row.created_at),
    paidAt: row.paid_at ? iso(row.paid_at) : undefined,
    fulfilment: row.fulfilment,
    trackingNumber: row.tracking_number ?? undefined,
    fulfilmentUpdatedAt: row.fulfilment_updated_at ? iso(row.fulfilment_updated_at) : undefined,
  };
}

const SELECT_ORDER = `SELECT * FROM orders WHERE `;

class PostgresOrderStore implements OrderStore {
  private async hydrate(rows: OrderRow[]): Promise<Order | undefined> {
    const row = rows[0];
    if (!row) return undefined;
    const db = await getDb();
    const items = await db.query<ItemRow>(
      `SELECT product_id, name, unit_price, quantity, line_total
         FROM order_items WHERE order_id = $1 ORDER BY position`,
      [row.id],
    );
    return rowToOrder(row, items.rows);
  }

  async create(order: NewOrder): Promise<Order> {
    const db = await getDb();

    // The reference is random and unique-constrained; on the rare collision,
    // generate another rather than failing the customer's checkout.
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = randomUUID();
      const reference = newOrderReference();
      try {
        return await db.transaction(async (tx) => {
          const inserted = await tx.query<OrderRow>(
            `INSERT INTO orders (
               id, reference, status,
               customer_full_name, customer_email, customer_phone,
               address_line1, address_line2, address_postcode, address_city, address_state,
               notes, subtotal, shipping, total, currency
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             RETURNING *`,
            [
              id,
              reference,
              order.status ?? "pending_payment",
              order.customer.fullName,
              order.customer.email,
              order.customer.phone,
              order.address.line1,
              order.address.line2 ?? null,
              order.address.postcode,
              order.address.city,
              order.address.state,
              order.notes ?? null,
              order.subtotal,
              order.shipping,
              order.total,
              order.currency,
            ],
          );

          // Items go in the same transaction: an order without its lines is
          // worse than no order at all.
          for (const [position, item] of order.items.entries()) {
            await tx.query(
              `INSERT INTO order_items (order_id, product_id, name, unit_price, quantity, line_total, position)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [id, item.productId, item.name, item.unitPrice, item.quantity, item.lineTotal, position],
            );
          }

          return rowToOrder(inserted.rows[0], [
            ...order.items.map((i) => ({
              product_id: i.productId,
              name: i.name,
              unit_price: String(i.unitPrice),
              quantity: i.quantity,
              line_total: String(i.lineTotal),
            })),
          ]);
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === UNIQUE_VIOLATION && attempt < 4) continue;
        throw error;
      }
    }
    throw new Error("Could not allocate a unique order reference.");
  }

  async byReference(reference: string) {
    const db = await getDb();
    const rows = await db.query<OrderRow>(`${SELECT_ORDER}reference = $1`, [reference]);
    return this.hydrate(rows.rows);
  }

  async byPaymentId(paymentId: string) {
    const db = await getDb();
    const rows = await db.query<OrderRow>(`${SELECT_ORDER}payment_id = $1`, [paymentId]);
    return this.hydrate(rows.rows);
  }

  async attachPayment(id: string, payment: { paymentId: string; paymentUrl: string; markPaid?: boolean }) {
    const db = await getDb();
    const rows = await db.query<OrderRow>(
      `UPDATE orders
          SET payment_id  = $2,
              payment_url = $3,
              status      = CASE WHEN $4::boolean THEN 'paid' ELSE status END,
              paid_at     = CASE WHEN $4::boolean THEN now() ELSE paid_at END
        WHERE id = $1
        RETURNING *`,
      [id, payment.paymentId, payment.paymentUrl, payment.markPaid ?? false],
    );
    return this.hydrate(rows.rows);
  }

  async setStatus(id: string, status: OrderStatus) {
    const db = await getDb();
    // `status <> 'paid'` is the whole point: a settled order cannot be moved
    // by a late failure or a duplicate callback, and because the check lives
    // in the UPDATE, two concurrent callbacks cannot both pass it.
    const rows = await db.query<OrderRow>(
      `UPDATE orders
          SET status  = $2,
              paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END
        WHERE id = $1
          AND (status <> 'paid' OR $2 = 'paid')
        RETURNING *`,
      [id, status],
    );
    return this.hydrate(rows.rows);
  }

  // --- admin -----------------------------------------------------------------

  async list(filter: OrderFilter = {}) {
    const db = await getDb();

    // Conditions are assembled as parameter placeholders; no caller input is
    // ever interpolated into the SQL string.
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.fulfilment) {
      params.push(filter.fulfilment);
      where.push(`fulfilment = $${params.length}`);
    }
    if (filter.search?.trim()) {
      params.push(`%${filter.search.trim().toLowerCase()}%`);
      const p = `$${params.length}`;
      where.push(`(lower(reference) LIKE ${p} OR lower(customer_email) LIKE ${p} OR lower(customer_full_name) LIKE ${p})`);
    }

    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.min(100, Math.max(1, filter.limit ?? 25));
    const offset = Math.max(0, filter.offset ?? 0);

    const counted = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM orders ${clause}`,
      params,
    );

    const rows = await db.query<OrderRow>(
      `SELECT * FROM orders ${clause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    // One query for every line rather than one per order.
    const ids = rows.rows.map((r) => r.id);
    const items = ids.length
      ? await db.query<ItemRow & { order_id: string }>(
          `SELECT order_id, product_id, name, unit_price, quantity, line_total
             FROM order_items WHERE order_id = ANY($1) ORDER BY position`,
          [ids],
        )
      : { rows: [] };

    const byOrder = new Map<string, ItemRow[]>();
    for (const item of items.rows) {
      const list = byOrder.get(item.order_id) ?? [];
      list.push(item);
      byOrder.set(item.order_id, list);
    }

    return {
      orders: rows.rows.map((r) => rowToOrder(r, byOrder.get(r.id) ?? [])),
      total: Number(counted.rows[0]?.count ?? 0),
    };
  }

  async stats(): Promise<OrderStats> {
    const db = await getDb();
    // Revenue counts settled orders only — an unpaid order is not income.
    const rows = await db.query<{
      revenue: string;
      paid: string;
      pending: string;
      failed: string;
      awaiting: string;
    }>(
      `SELECT
         COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0)::text AS revenue,
         count(*) FILTER (WHERE status = 'paid')::text            AS paid,
         count(*) FILTER (WHERE status = 'pending_payment')::text  AS pending,
         count(*) FILTER (WHERE status = 'failed')::text           AS failed,
         count(*) FILTER (WHERE status = 'paid'
                            AND fulfilment IN ('unfulfilled','packed'))::text AS awaiting
       FROM orders`,
    );
    const r = rows.rows[0];
    return {
      revenue: amount(r?.revenue ?? "0"),
      paidCount: Number(r?.paid ?? 0),
      pendingCount: Number(r?.pending ?? 0),
      failedCount: Number(r?.failed ?? 0),
      awaitingFulfilment: Number(r?.awaiting ?? 0),
    };
  }

  async setFulfilment(id: string, fulfilment: Fulfilment, trackingNumber?: string | null) {
    const db = await getDb();
    // `status = 'paid'` in the WHERE clause: an unpaid order must never be
    // marked shipped, and enforcing it here means no caller can forget to check.
    const rows = await db.query<OrderRow>(
      `UPDATE orders
          SET fulfilment            = $2,
              tracking_number       = COALESCE($3, tracking_number),
              fulfilment_updated_at = now()
        WHERE id = $1
          AND status = 'paid'
        RETURNING *`,
      [id, fulfilment, trackingNumber ?? null],
    );
    return this.hydrate(rows.rows);
  }
}

export const orderStore: OrderStore = new PostgresOrderStore();
