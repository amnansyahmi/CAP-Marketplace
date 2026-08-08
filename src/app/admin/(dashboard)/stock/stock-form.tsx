"use client";

import { useActionState } from "react";

import { updateStock } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StockForm({
  productId,
  name,
  tracked,
  onHand,
  reserved,
}: {
  productId: string;
  name: string;
  tracked: boolean;
  onHand: number;
  reserved: number;
}) {
  const [state, formAction, pending] = useActionState(updateStock, undefined);
  const available = Math.max(0, onHand - reserved);

  return (
    <form action={formAction} className="rounded-lg border border-border bg-card p-5">
      <input type="hidden" name="productId" value={productId} />

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-2xl tracking-[-.02em]">{name}</h2>
        {tracked ? (
          <span className={`text-sm ${available === 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {available} available
            {reserved > 0 && ` · ${reserved} held by unpaid orders`}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Not tracked</span>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-4">
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
      </div>

      {state?.message && (
        <p role="status" className="mt-4 text-xs text-muted-foreground">
          {state.message}
        </p>
      )}

      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        {tracked
          ? "Customers cannot order more than the available count, and stock is held from the moment an order is placed rather than when it is paid."
          : "Untracked products sell without limit. Turn tracking on once you have counted what you have."}
      </p>
    </form>
  );
}
