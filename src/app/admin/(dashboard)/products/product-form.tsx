"use client";

import { useActionState } from "react";

import { resetProductPrice, updateProduct } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_PRICE, MIN_PRICE } from "@/lib/price-rules";
import { money } from "@/lib/utils";

export function ProductForm({
  productId,
  name,
  price,
  cataloguePrice,
  priceChangedAt,
  tracked,
  onHand,
  reserved,
  soldThisMonth,
}: {
  productId: string;
  name: string;
  /** What customers pay today. */
  price: number;
  /** The launch price compiled into the catalogue, for comparison. */
  cataloguePrice: number;
  /** When the shop owner last changed it, if they have. */
  priceChangedAt?: string;
  tracked: boolean;
  onHand: number;
  reserved: number;
  /** Jars sold in the last 30 days, so a price is not set in the dark. */
  soldThisMonth: number;
}) {
  const [state, formAction, pending] = useActionState(updateProduct, undefined);
  const [resetState, resetAction, resetting] = useActionState(resetProductPrice, undefined);
  const available = Math.max(0, onHand - reserved);
  const overridden = price !== cataloguePrice;
  const feedback = state?.error ?? state?.message ?? resetState?.error ?? resetState?.message;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-2xl tracking-[-.02em]">{name}</h2>
        <div className="flex flex-wrap items-baseline gap-4 text-sm text-muted-foreground">
          <span>
            {soldThisMonth} sold in 30 days
          </span>
          {tracked ? (
            <span className={available === 0 ? "text-destructive" : undefined}>
              {available} available
              {reserved > 0 && ` · ${reserved} held by unpaid orders`}
            </span>
          ) : (
            <span>Not tracked</span>
          )}
        </div>
      </div>

      <form action={formAction} className="mt-5 flex flex-wrap items-end gap-4">
        <input type="hidden" name="productId" value={productId} />

        <div className="w-36">
          <Label htmlFor={`price-${productId}`} className="mb-2">
            Price (RM)
          </Label>
          <Input
            id={`price-${productId}`}
            name="price"
            type="number"
            inputMode="decimal"
            min={MIN_PRICE}
            max={MAX_PRICE}
            step="0.10"
            defaultValue={price.toFixed(2)}
          />
        </div>

        <div className="w-32">
          <Label htmlFor={`on-hand-${productId}`} className="mb-2">
            On hand
          </Label>
          <Input
            id={`on-hand-${productId}`}
            name="onHand"
            type="number"
            min="0"
            step="1"
            defaultValue={onHand}
          />
        </div>

        <label className="flex items-center gap-2.5 pb-2.5 text-sm">
          <input
            type="checkbox"
            name="tracked"
            value="true"
            defaultChecked={tracked}
            className="size-4 rounded-sm border-border accent-[#9b3d29]"
          />
          Track stock for this product
        </label>

        <Button type="submit" variant="outline" size="sm" className="mb-1" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>

      {overridden && (
        <form action={resetAction} className="mt-3">
          <input type="hidden" name="productId" value={productId} />
          <p className="text-xs leading-5 text-muted-foreground">
            Catalogue price is {money(cataloguePrice)}
            {priceChangedAt && ` · changed ${new Date(priceChangedAt).toLocaleDateString("en-MY", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}`}
            .{" "}
            <button
              type="submit"
              disabled={resetting}
              className="underline underline-offset-2 transition-colors hover:text-primary disabled:opacity-50"
            >
              {resetting ? "Resetting…" : "Reset to catalogue price"}
            </button>
          </p>
        </form>
      )}

      {feedback && (
        <p
          role="status"
          className={`mt-4 text-xs ${state?.error || resetState?.error ? "text-destructive" : "text-muted-foreground"}`}
        >
          {feedback}
        </p>
      )}

      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        A price change applies to new orders only — every order keeps the price it was placed at.{" "}
        {tracked
          ? "Customers cannot order more than the available count, and stock is held from the moment an order is placed rather than when it is paid."
          : "Untracked products sell without limit. Turn tracking on once you have counted what you have."}
      </p>
    </div>
  );
}
