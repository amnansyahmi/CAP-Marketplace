"use client";

import { useActionState } from "react";

import { bookShipmentAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

export function ShipmentForm({
  orderId,
  courier,
  serviceName,
  cost,
}: {
  orderId: string;
  courier?: string;
  serviceName?: string;
  cost?: string;
}) {
  const [state, formAction, pending] = useActionState(bookShipmentAction, undefined);

  return (
    <>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {courier
          ? `The customer chose ${courier}${serviceName ? ` · ${serviceName}` : ""}.`
          : "This order was placed on the flat rate, so there is no courier service to book."}
      </p>
      {/* Only meaningful when there is actually something to book — quoting a
          booking cost next to "there is no courier service" reads as a bug. */}
      {courier && cost && (
        <p className="mt-2 text-sm">
          Booking will cost about <strong>{cost}</strong> in EasyParcel credit.
        </p>
      )}
      {!courier && (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Post it yourself and enter the tracking number under Fulfilment. Orders placed once
          EasyParcel is configured will offer courier booking here.
        </p>
      )}

      <form action={formAction} className="mt-5 space-y-3">
        <input type="hidden" name="orderId" value={orderId} />

        {(state?.error || state?.ok) && (
          <p
            role="alert"
            className={`rounded-md border p-3 text-xs leading-5 ${
              state.error
                ? "border-destructive/40 bg-destructive/5 text-destructive"
                : "border-border bg-muted/50 text-muted-foreground"
            }`}
          >
            {state.error ?? state.ok}
          </p>
        )}

        <Button type="submit" variant="warm" size="sm" disabled={pending || !courier}>
          {pending ? "Booking…" : "Book the parcel"}
        </Button>
      </form>

      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Booking spends real EasyParcel credit and cannot be undone from here. The consignment number
        is filled in automatically, and marking the order shipped emails it to the customer.
      </p>
    </>
  );
}
