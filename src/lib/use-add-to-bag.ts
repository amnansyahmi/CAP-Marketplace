"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import { useCart } from "@/lib/cart-context";
import type { Product } from "@/lib/products";

/**
 * Adds to the bag and confirms it with a toast carrying a "View bag" action —
 * the standard marketplace pattern, so the customer can jump straight to the
 * drawer instead of hunting for the header link.
 *
 * Shared by the product grid, the quick view dialog and the product page so
 * the confirmation behaves identically wherever the customer adds from.
 */
export function useAddToBag() {
  const { add, openBag } = useCart();

  return useCallback(
    (product: Product, quantity = 1) => {
      add(product, quantity);
      toast(quantity > 1 ? `${product.name} — ${quantity} added to bag` : `${product.name} — added to bag`, {
        action: { label: "View bag", onClick: openBag },
      });
    },
    [add, openBag],
  );
}
