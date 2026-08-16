"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { products, type Product } from "@/lib/products";

/**
 * Stock and prices as they are right now, for a storefront that was rendered
 * earlier.
 *
 * The shop's pages are static — that is what lets five thousand people read
 * them without touching the database. The cost is that whatever was true when
 * a page was built is what it says, and a price the owner changed this morning
 * is exactly the kind of thing that must not wait for a redeploy.
 *
 * So one request, once, from the root of the app: `/api/availability` is
 * already cached for fifteen seconds and already carried stock, and it now
 * carries prices too. Fetching it here rather than in each component means the
 * whole page shares a single answer instead of racing several.
 *
 * None of this is a control. The displayed price is a courtesy to the visitor;
 * `/api/orders` prices every line from the database when the order is placed,
 * so a stale — or edited — number here cannot buy anything cheaply.
 */

export type LiveProduct = {
  /** Null when the product is not stock-tracked, so there is no limit. */
  available: number | null;
  soldOut: boolean;
  /** Null when the shop has not overridden the catalogue price. */
  price: number | null;
};

const LiveCatalogueContext = createContext<Map<string, LiveProduct>>(new Map());

export function LiveCatalogueProvider({ children }: { children: React.ReactNode }) {
  const [live, setLive] = useState<Map<string, LiveProduct>>(new Map());

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/availability", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { products?: ({ productId: string } & LiveProduct)[] } | null) => {
        if (!data?.products) return;
        setLive(
          new Map(
            data.products.map((p) => [
              p.productId,
              { available: p.available, soldOut: p.soldOut, price: p.price },
            ]),
          ),
        );
      })
      .catch(() => {
        // Aborted or offline. An empty map means the page keeps the prices and
        // availability it was rendered with, which is a working shop.
      });

    return () => controller.abort();
  }, []);

  return <LiveCatalogueContext.Provider value={live}>{children}</LiveCatalogueContext.Provider>;
}

export function useLiveCatalogue(): Map<string, LiveProduct> {
  return useContext(LiveCatalogueContext);
}

/**
 * Prices a server-rendered page already knew, handed to the components below it.
 *
 * Without this, a statically rendered page paints the price it was built with
 * and corrects it a moment later — on the shop's front door, that flash is a
 * customer watching the price change in front of them. A page that reads the
 * database anyway (the home page and product pages both rebuild every five
 * minutes) can simply render the right number the first time.
 *
 * Merges rather than replaces: the fetched catalogue carries stock as well, and
 * once it arrives it wins. This only fills the gap before then.
 */
export function SeedPrices({
  prices,
  children,
}: {
  prices: Record<string, number>;
  children: React.ReactNode;
}) {
  const fetched = useLiveCatalogue();

  const merged = useMemo(() => {
    const next = new Map<string, LiveProduct>(fetched);
    for (const [productId, price] of Object.entries(prices)) {
      const live = next.get(productId);
      if (live) {
        // Only fill in a price the fetch did not carry; never override it.
        if (live.price === null) next.set(productId, { ...live, price });
      } else {
        next.set(productId, { available: null, soldOut: false, price });
      }
    }
    return next;
  }, [fetched, prices]);

  return <LiveCatalogueContext.Provider value={merged}>{children}</LiveCatalogueContext.Provider>;
}

/** Today's price for one product, falling back to what the page was built with. */
export function priceOf(product: Product, live: Map<string, LiveProduct>): number {
  return live.get(product.id)?.price ?? product.price;
}

/** The same product with today's price on it, so callers can keep using `.price`. */
export function pricedFor(product: Product, live: Map<string, LiveProduct>): Product {
  const price = priceOf(product, live);
  return price === product.price ? product : { ...product, price };
}

/** The lowest price in the shop, for "from RM x" copy. */
export function startingPriceOf(live: Map<string, LiveProduct>): number {
  return Math.min(...products.map((product) => priceOf(product, live)));
}

/**
 * A hook for components that only care about stock.
 *
 * Kept so the availability call sites read the same as they always did, now
 * served from the one shared fetch rather than one of their own.
 */
export function useAvailability(): Map<string, { available: number | null; soldOut: boolean }> {
  const live = useLiveCatalogue();
  return useMemo(
    () => new Map([...live].map(([id, p]) => [id, { available: p.available, soldOut: p.soldOut }])),
    [live],
  );
}
