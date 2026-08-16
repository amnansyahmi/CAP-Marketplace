"use client";

import { useActionState, useState } from "react";

import { refundOrder } from "@/app/admin/actions";
import { gatewayLabel } from "@/lib/payments/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RefundForm({ orderId, amount }: { orderId: string; amount: string }) {
  const [state, formAction, pending] = useActionState(refundOrder, undefined);
  // A refund cannot be undone from here and the customer gets an email about
  // it, so it takes a deliberate second action rather than one stray click.
  const [confirming, setConfirming] = useState(false);

  if (state?.ok) {
    return (
      <p role="status" className="mt-4 text-sm leading-6 text-muted-foreground">
        {state.ok}
      </p>
    );
  }

  return (
    <>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Records a full refund of {amount}, voids any unpaid commission and agent fee, puts the stock
        back and emails the customer.
      </p>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        This does not move money. Issue the refund in {gatewayLabel()} as well — this records that you
        did, so the shop&rsquo;s figures stop counting it as income.
      </p>

      <form action={formAction} className="mt-5 space-y-3">
        <input type="hidden" name="orderId" value={orderId} />
        <Label htmlFor="refund-reason">Reason (optional)</Label>
        <Input
          id="refund-reason"
          name="reason"
          placeholder="Jar arrived damaged"
          maxLength={200}
          aria-describedby="refund-reason-hint"
        />
        <p id="refund-reason-hint" className="text-xs text-muted-foreground">
          Included in the email to the customer.
        </p>

        {state?.error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            {state.error}
          </p>
        )}

        {confirming ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="warm" size="sm" disabled={pending}>
              {pending ? "Refunding…" : `Yes, refund ${amount}`}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
            Refund {amount}
          </Button>
        )}
      </form>
    </>
  );
}
