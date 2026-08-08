"use client";

import { useActionState } from "react";

import { findOrder } from "@/app/orders/find/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function FindOrderForm() {
  const [state, formAction, pending] = useActionState(findOrder, undefined);

  return (
    <form action={formAction} className="mt-10 space-y-5">
      <div>
        <Label htmlFor="reference" className="mb-2">
          Order reference
        </Label>
        <Input
          id="reference"
          name="reference"
          required
          autoFocus
          placeholder="CA-7F3K9Q"
          autoCapitalize="characters"
          spellCheck={false}
          className="font-mono uppercase"
          aria-invalid={!!state?.error}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          It is at the top of every email we sent about the order.
        </p>
      </div>

      <div>
        <Label htmlFor="email" className="mb-2">
          Email address
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@email.com"
          aria-invalid={!!state?.error}
          aria-describedby={state?.error ? "find-error" : undefined}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">The one you used when ordering.</p>
      </div>

      {state?.error && (
        <p
          id="find-error"
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs leading-5 text-destructive"
        >
          {state.error}
        </p>
      )}

      <Button type="submit" variant="warm" size="lg" className="w-full" disabled={pending}>
        {pending ? "Looking…" : "Find my order"}
      </Button>
    </form>
  );
}
