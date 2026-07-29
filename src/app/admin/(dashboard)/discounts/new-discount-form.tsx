"use client";

import { useActionState } from "react";

import { createDiscount } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewDiscountForm() {
  const [state, formAction, pending] = useActionState(createDiscount, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="code" className="mb-2">
          Code
        </Label>
        <Input
          id="code"
          name="code"
          required
          placeholder="RAYA20"
          autoCapitalize="characters"
          spellCheck={false}
          className="font-mono uppercase"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          What the customer types at checkout. Letters, digits and dashes.
        </p>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Type</legend>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" value="percent" defaultChecked className="accent-[#9b3d29]" />
            Percentage
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" value="fixed" className="accent-[#9b3d29]" />
            Fixed ringgit
          </label>
        </div>
      </fieldset>

      <div>
        <Label htmlFor="value" className="mb-2">
          Value
        </Label>
        <Input id="value" name="value" type="number" min="0.01" step="0.01" required placeholder="20" />
        <p className="mt-1.5 text-xs text-muted-foreground">
          20 means 20% for a percentage code, or RM 20.00 for a fixed one.
        </p>
      </div>

      <div>
        <Label htmlFor="minSubtotal" className="mb-2">
          Minimum spend (optional)
        </Label>
        <Input id="minSubtotal" name="minSubtotal" type="number" min="0" step="0.01" placeholder="0" />
      </div>

      <div>
        <Label htmlFor="maxRedemptions" className="mb-2">
          Usage limit (optional)
        </Label>
        <Input id="maxRedemptions" name="maxRedemptions" type="number" min="1" step="1" placeholder="Unlimited" />
      </div>

      <div>
        <Label htmlFor="expiresAt" className="mb-2">
          Expires (optional)
        </Label>
        <Input id="expiresAt" name="expiresAt" type="date" />
      </div>

      {(state?.error || state?.ok) && (
        <p
          role="alert"
          className={`rounded-md border p-3 text-xs ${
            state.error
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-border bg-muted/50 text-muted-foreground"
          }`}
        >
          {state.error ?? state.ok}
        </p>
      )}

      <Button type="submit" variant="warm" disabled={pending}>
        {pending ? "Creating…" : "Create code"}
      </Button>

      <p className="text-xs leading-5 text-muted-foreground">
        Discounts come off the goods subtotal, never delivery. Affiliate commission is worked out on
        the discounted figure, so nobody earns a percentage of money the shop did not take.
      </p>
    </form>
  );
}
