/**
 * Stock.
 *
 * Three rules, all of them about not selling something twice:
 *
 * 1. **Stock is reserved when the order is placed, not when it is paid.**
 *    Someone on the payment page is holding the last jar. Decrementing only on
 *    payment would let a second customer buy it while the first is still
 *    typing their card number, and one of them would get an apology instead of
 *    an order.
 * 2. **A reservation is released exactly once.** An order that fails and is
 *    later cancelled must not give its jars back twice — that would invent
 *    inventory the shop does not have. The order carries a `stock_state` and
 *    every transition is guarded in SQL.
 * 3. **Tracking is opt-in per product.** Switching this on for a shop that has
 *    never counted would take the whole catalogue off sale the moment the table
 *    appeared. Untracked products sell exactly as they did before.
 *
 * The availability check and the reservation happen inside one transaction with
 * the rows locked. Checking first and writing after would let two requests both
 * read "one left" and both decide they may have it.
 */

import { getDb, type Db } from "@/lib/db/client";
import { products } from "@/lib/products";

export type StockLevel = {
  productId: string;
  tracked: boolean;
  onHand: number;
  reserved: number;
  /** What a customer can actually buy right now. */
  available: number;
};

export type StockLine = { productId: string; quantity: number };

export type ReservationResult =
  | { ok: true }
  | { ok: false; shortfalls: { productId: string; wanted: number; available: number }[] };

type StockRow = {
  product_id: string;
  tracked: boolean;
  on_hand: number | string;
  reserved: number | string;
};

function rowToLevel(row: StockRow): StockLevel {
  const onHand = Number(row.on_hand);
  const reserved = Number(row.reserved);
  return {
    productId: row.product_id,
    tracked: row.tracked,
    onHand,
    reserved,
    available: Math.max(0, onHand - reserved),
  };
}

/**
 * Makes sure every catalogue product has a row.
 *
 * Cheap and idempotent, so it runs before any read rather than being a
 * migration step somebody has to remember after adding a product.
 */
async function ensureRows(db: Db): Promise<void> {
  if (products.length === 0) return;
  const values = products.map((_, i) => `($${i + 1})`).join(",");
  await db.query(
    `INSERT INTO product_stock (product_id)
     SELECT * FROM (VALUES ${values}) AS v(product_id)
     ON CONFLICT (product_id) DO NOTHING`,
    products.map((p) => p.id),
  );
}

export async function stockLevels(): Promise<StockLevel[]> {
  const db = await getDb();
  await ensureRows(db);
  const rows = await db.query<StockRow>(
    `SELECT product_id, tracked, on_hand, reserved FROM product_stock`,
  );
  const byId = new Map(rows.rows.map((row) => [row.product_id, rowToLevel(row)]));
  // Catalogue order, so the admin and the shop agree on how products are listed.
  return products.map(
    (product) =>
      byId.get(product.id) ?? {
        productId: product.id,
        tracked: false,
        onHand: 0,
        reserved: 0,
        available: 0,
      },
  );
}

/** Availability keyed by product id, for the storefront. */
export async function availability(): Promise<Map<string, StockLevel>> {
  return new Map((await stockLevels()).map((level) => [level.productId, level]));
}

export async function setStock(
  productId: string,
  { tracked, onHand }: { tracked: boolean; onHand: number },
): Promise<StockLevel | undefined> {
  const db = await getDb();
  await ensureRows(db);
  const rows = await db.query<StockRow>(
    `UPDATE product_stock
        SET tracked = $2, on_hand = GREATEST(0, $3), updated_at = now()
      WHERE product_id = $1
      RETURNING product_id, tracked, on_hand, reserved`,
    [productId, tracked, Math.floor(onHand)],
  );
  return rows.rows[0] ? rowToLevel(rows.rows[0]) : undefined;
}

/**
 * Holds stock for an order that is about to be placed.
 *
 * Returns the shortfalls rather than throwing, so the caller can tell the
 * customer which item ran out instead of failing the whole checkout with a
 * generic error.
 */
export async function reserve(lines: StockLine[]): Promise<ReservationResult> {
  const wanted = new Map<string, number>();
  for (const line of lines) {
    wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + Math.max(0, Math.floor(line.quantity)));
  }
  if (wanted.size === 0) return { ok: true };

  const db = await getDb();
  await ensureRows(db);

  return db.transaction(async (tx) => {
    const ids = [...wanted.keys()];
    // FOR UPDATE: the check and the write have to see the same rows, and no
    // one else may change them in between. Ordered so two orders touching the
    // same pair of products always lock them in the same sequence and cannot
    // deadlock against each other.
    const rows = await tx.query<StockRow>(
      `SELECT product_id, tracked, on_hand, reserved
         FROM product_stock
        WHERE product_id = ANY($1)
        ORDER BY product_id
          FOR UPDATE`,
      [ids],
    );

    const shortfalls: { productId: string; wanted: number; available: number }[] = [];
    const toReserve: StockLine[] = [];

    for (const row of rows.rows) {
      const level = rowToLevel(row);
      const quantity = wanted.get(level.productId) ?? 0;
      if (!level.tracked) continue; // untracked sells without limit
      if (level.available < quantity) {
        shortfalls.push({ productId: level.productId, wanted: quantity, available: level.available });
      } else {
        toReserve.push({ productId: level.productId, quantity });
      }
    }

    // All or nothing: a customer should not end up with half an order because
    // one line ran out while they were checking out.
    if (shortfalls.length > 0) return { ok: false, shortfalls };

    for (const line of toReserve) {
      await tx.query(
        `UPDATE product_stock
            SET reserved = reserved + $2, updated_at = now()
          WHERE product_id = $1`,
        [line.productId, line.quantity],
      );
    }

    return { ok: true };
  });
}

/**
 * Turns a reservation into a sale: the jars leave the shelf.
 *
 * Guarded on `stock_state = 'reserved'`, so a webhook delivered twice cannot
 * take the same stock off twice.
 */
export async function commitReservation(orderId: string): Promise<boolean> {
  return moveReservation(orderId, "committed");
}

/**
 * Gives a reservation back after a failed or cancelled order.
 *
 * Also guarded on `stock_state = 'reserved'`: an order that failed and was then
 * cancelled would otherwise return its jars twice.
 */
export async function releaseReservation(orderId: string): Promise<boolean> {
  return moveReservation(orderId, "released");
}

async function moveReservation(orderId: string, next: "committed" | "released"): Promise<boolean> {
  const db = await getDb();

  return db.transaction(async (tx) => {
    // The guard is the UPDATE's own WHERE clause, not a read followed by a
    // decision: two callbacks arriving together would both read 'reserved'.
    const claimed = await tx.query<{ id: string }>(
      `UPDATE orders SET stock_state = $2
        WHERE id = $1 AND stock_state = 'reserved'
        RETURNING id`,
      [orderId, next],
    );
    if (claimed.rows.length === 0) return false;

    const items = await tx.query<{ product_id: string; quantity: number | string }>(
      `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
      [orderId],
    );

    for (const item of items.rows) {
      const quantity = Number(item.quantity);
      if (next === "committed") {
        await tx.query(
          `UPDATE product_stock
              SET on_hand  = GREATEST(0, on_hand - $2),
                  reserved = GREATEST(0, reserved - $2),
                  updated_at = now()
            WHERE product_id = $1 AND tracked = true`,
          [item.product_id, quantity],
        );
      } else {
        await tx.query(
          `UPDATE product_stock
              SET reserved = GREATEST(0, reserved - $2), updated_at = now()
            WHERE product_id = $1 AND tracked = true`,
          [item.product_id, quantity],
        );
      }
    }

    return true;
  });
}

/** Marks an order as holding a reservation. Called as the order is created. */
export async function markReserved(orderId: string): Promise<void> {
  const db = await getDb();
  await db.query(`UPDATE orders SET stock_state = 'reserved' WHERE id = $1 AND stock_state = 'none'`, [
    orderId,
  ]);
}
