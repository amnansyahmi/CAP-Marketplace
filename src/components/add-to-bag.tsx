"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";

import { useCart } from "@/lib/cart-context";
import type { Product } from "@/lib/products";
import { Button } from "@/components/ui/button";

/** Quantity picker + add button used on the product detail page. */
export function AddToBag({ product }: { product: Product }) {
  const [quantity, setQuantity] = useState(1);
  const { add } = useCart();

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="flex h-13 w-fit items-center border border-border">
        <button
          type="button"
          className="grid size-12 place-items-center transition-colors hover:bg-muted disabled:opacity-40"
          onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          disabled={quantity <= 1}
          aria-label="Decrease quantity"
        >
          <Minus className="size-3.5" />
        </button>
        <span className="w-10 text-center text-sm" aria-live="polite">
          {quantity}
        </span>
        <button
          type="button"
          className="grid size-12 place-items-center transition-colors hover:bg-muted disabled:opacity-40"
          onClick={() => setQuantity((q) => Math.min(99, q + 1))}
          disabled={quantity >= 99}
          aria-label="Increase quantity"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <Button
        variant="warm"
        size="lg"
        className="flex-1"
        onClick={() => {
          add(product, quantity);
          toast(`${product.name} — ${quantity} added to bag`);
        }}
      >
        Add to bag
      </Button>
    </div>
  );
}
