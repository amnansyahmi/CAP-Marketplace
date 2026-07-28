"use client";

import { useActionState } from "react";

import { createAffiliate } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewAffiliateForm() {
  const [state, formAction, pending] = useActionState(createAffiliate, undefined);

  return (
    <form action={formAction} className="mt-6 space-y-4 rounded-lg border border-border bg-card p-6">
      <div>
        <Label htmlFor="code" className="mb-2">
          Referral code
        </Label>
        <Input id="code" name="code" required placeholder="AMINA10" autoCapitalize="characters" />
        <p className="mt-2 text-xs text-muted-foreground">
          Appears in their link as <code className="font-mono">?ref=CODE</code>. Letters, digits and dashes.
        </p>
      </div>
      <div>
        <Label htmlFor="name" className="mb-2">
          Name
        </Label>
        <Input id="name" name="name" required />
      </div>
      <div>
        <Label htmlFor="email" className="mb-2">
          Email
        </Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div>
        <Label htmlFor="phone" className="mb-2">
          Phone <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input id="phone" name="phone" type="tel" />
      </div>
      <div>
        <Label htmlFor="commissionPercent" className="mb-2">
          Commission %
        </Label>
        <Input
          id="commissionPercent"
          name="commissionPercent"
          type="number"
          min="0"
          max="100"
          step="0.5"
          defaultValue="10"
          required
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Taken on the order subtotal, not on delivery.
        </p>
      </div>

      {state?.error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="rounded-md border border-border bg-muted/60 p-3 text-xs text-muted-foreground">
          {state.ok}
        </p>
      )}

      <Button type="submit" variant="warm" className="w-full" disabled={pending}>
        {pending ? "Adding…" : "Add affiliate"}
      </Button>
    </form>
  );
}
