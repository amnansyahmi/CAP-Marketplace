"use client";

import { useEffect, useState } from "react";

export type Availability = {
  /** Null when the product is not stock-tracked, so there is no limit. */
  available: number | null;
  soldOut: boolean;
};

/**
 * Live stock, fetched once per mount.
 *
 * Starts empty and treats an unknown product as buyable. Two reasons: the
 * storefront is statically rendered and must read correctly before this
 * resolves, and if the request fails the shop should stay open rather than
 * showing an entire catalogue as sold out because of one bad response.
 *
 * This is a *courtesy*, not a control. The order API re-checks and reserves
 * stock server-side, so a stale or spoofed answer here cannot oversell
 * anything — it only decides what the buttons look like.
 */
export function useAvailability(): Map<string, Availability> {
  const [levels, setLevels] = useState<Map<string, Availability>>(new Map());

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/availability", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { products?: { productId: string; available: number | null; soldOut: boolean }[] } | null) => {
        if (!data?.products) return;
        setLevels(
          new Map(data.products.map((p) => [p.productId, { available: p.available, soldOut: p.soldOut }])),
        );
      })
      .catch(() => {
        // Aborted or offline. Leaving the map empty means everything stays
        // buyable, and the server still has the final say.
      });

    return () => controller.abort();
  }, []);

  return levels;
}
