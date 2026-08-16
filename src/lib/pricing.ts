/**
 * What each product costs today.
 *
 * Prices used to live only in `src/lib/products.ts`, which meant changing one
 * was a code edit and a deploy. They are now an override in the database that
 * the shop owner sets from the admin, with the catalogue price as the default —
 * so a fresh database sells at the launch prices and nothing has to be seeded.
 *
 * Three rules this file exists to keep:
 *
 * 1. **The server decides the price.** The browser is told what something costs
 *    so it can show a total; it is never asked. `/api/orders` prices every line
 *    from here, exactly as it always did from the catalogue.
 * 2. **A past order is never re-priced.** Orders snapshot `unitPrice` into
 *    `order_items` when they are placed. Nothing here reads or writes that.
 * 3. **A database that is unreachable must not take the shop down.** Every read
 *    falls back to the catalogue price, which is compiled in and always there —
 *    that is also what makes the storefront buildable without a database.
 */

import { getDb } from "@/lib/db/client";
import { priceProblem } from "@/lib/price-rules";
import { products, productById, type Product } from "@/lib/products";

// Re-exported so server callers have one import for pricing. The rules
// themselves live apart, where a client component can reach them.
export { MAX_PRICE, MIN_PRICE, priceProblem } from "@/lib/price-rules";

/**
 * Prices are read on the storefront, in three API routes and on every product
 * page. Re-reading the table for each of those would put a query on the hottest
 * path in the shop to learn something that changes a few times a year.
 *
 * Thirty seconds, and cleared outright on this instance when a price is saved:
 * the admin sees the change immediately, and other instances catch up within
 * the window.
 */
const CACHE_TTL_MS = 30_000;
let cache: { prices: Map<string, number>; expiresAt: number } | undefined;

/** Catalogue prices — what every product costs until somebody says otherwise. */
function defaults(): Map<string, number> {
  return new Map(products.map((product) => [product.id, product.price]));
}

/**
 * The effective price of every catalogue product.
 *
 * Always complete: a product with no override, or an override for something no
 * longer sold, resolves to the catalogue.
 */
export async function priceMap(): Promise<Map<string, number>> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.prices;

  const prices = defaults();
  try {
    const db = await getDb();
    const rows = await db.query<{ product_id: string; price: string }>(
      `SELECT product_id, price FROM product_prices`,
    );
    for (const row of rows.rows) {
      // Ignore a row for a product that has been delisted since.
      if (!prices.has(row.product_id)) continue;
      const price = Number(row.price);
      if (Number.isFinite(price) && price > 0) prices.set(row.product_id, price);
    }
    cache = { prices, expiresAt: now + CACHE_TTL_MS };
  } catch (error) {
    // No database — a build, or an outage. Catalogue prices are a correct
    // answer, so the shop keeps working; nothing is cached, so the next call
    // tries again.
    console.warn("Falling back to catalogue prices", error);
  }

  return prices;
}

/** The catalogue with today's prices applied. */
export async function pricedCatalogue(): Promise<Product[]> {
  const prices = await priceMap();
  return products.map((product) => withPrice(product, prices));
}

export async function pricedProduct(id: string): Promise<Product | undefined> {
  const product = productById(id);
  if (!product) return undefined;
  return withPrice(product, await priceMap());
}

/** The lowest price in the shop, for "from RM x" copy. */
export async function startingPrice(): Promise<number> {
  const prices = await priceMap();
  return Math.min(...products.map((product) => prices.get(product.id) ?? product.price));
}

export function withPrice(product: Product, prices: Map<string, number>): Product {
  const price = prices.get(product.id);
  return price === undefined || price === product.price ? product : { ...product, price };
}

export type PriceChange = { productId: string; from: number; to: number };

/**
 * Sets a price. Returns what changed, or a reason it was refused.
 *
 * Deliberately reports the previous price back to the caller: "saved" is not
 * useful feedback for an action whose whole point is what the number used to
 * be, and it is the sentence the admin shows.
 */
export async function setPrice(
  productId: string,
  price: number,
): Promise<{ ok: true; change: PriceChange } | { ok: false; reason: string }> {
  const product = productById(productId);
  if (!product) return { ok: false, reason: "That product is not in the catalogue." };

  const problem = priceProblem(price);
  if (problem) return { ok: false, reason: problem };

  const rounded = Math.round(price * 100) / 100;
  const before = (await priceMap()).get(productId) ?? product.price;

  const db = await getDb();
  await db.query(
    `INSERT INTO product_prices (product_id, price, updated_at)
          VALUES ($1, $2, now())
     ON CONFLICT (product_id) DO UPDATE SET price = $2, updated_at = now()`,
    [productId, rounded],
  );

  // This instance shows the new price at once; the rest are at most one cache
  // window behind, which for a price change is not a problem worth a broadcast.
  cache = undefined;

  return { ok: true, change: { productId, from: before, to: rounded } };
}

/**
 * Drops the override, putting a product back on its catalogue price.
 *
 * Distinct from setting the same number by hand: it says "there is no special
 * price here", so a later change to the catalogue takes effect as intended.
 */
export async function clearPrice(productId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query<{ product_id: string }>(
    `DELETE FROM product_prices WHERE product_id = $1 RETURNING product_id`,
    [productId],
  );
  cache = undefined;
  return rows.rows.length > 0;
}

/** Which products are on a price the shop owner set, and when they last changed. */
export async function priceOverrides(): Promise<Map<string, { price: number; updatedAt: string }>> {
  try {
    const db = await getDb();
    const rows = await db.query<{ product_id: string; price: string; updated_at: Date | string }>(
      `SELECT product_id, price, updated_at FROM product_prices`,
    );
    return new Map(
      rows.rows.map((row) => [
        row.product_id,
        {
          price: Number(row.price),
          updatedAt:
            row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
        },
      ]),
    );
  } catch {
    return new Map();
  }
}

/** Test seam — the cache is per-process and tests swap databases underneath it. */
export function resetPricingCacheForTests(): void {
  cache = undefined;
}
