"use client";

import { useActionState } from "react";

import { subscribeToNewsletter } from "@/app/actions/newsletter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The footer sign-up.
 *
 * This form used to accept an address, appear to succeed and throw it away.
 * It now actually records the subscriber, and says so honestly either way —
 * including when the shop has no mail provider configured, because a
 * "subscribed!" message from a shop that cannot send email is the same lie in a
 * different place.
 */
export function NewsletterForm() {
  const [state, formAction, pending] = useActionState(subscribeToNewsletter, undefined);

  if (state?.ok) {
    return (
      <div className="rounded-md border border-white/20 bg-white/5 p-4">
        <p role="status" className="text-sm leading-6 text-white">
          {state.ok}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row">
      <div className="flex-1">
        <Label htmlFor="newsletter-email" className="sr-only">
          Email address
        </Label>
        <Input
          id="newsletter-email"
          name="email"
          type="email"
          required
          placeholder="you@email.com"
          autoComplete="email"
          className="border-white/20 bg-white/5 text-white placeholder:text-white/55"
          aria-invalid={!!state?.error}
          aria-describedby={state?.error ? "newsletter-error" : undefined}
        />
        {state?.error && (
          <p id="newsletter-error" role="alert" className="mt-2 text-xs text-[#ffb4a2]">
            {state.error}
          </p>
        )}
      </div>
      <Button type="submit" variant="warm" disabled={pending}>
        {pending ? "Signing up…" : "Subscribe"}
      </Button>
    </form>
  );
}
