"use client";

import { useActionState } from "react";

import { affiliateLogin } from "@/app/affiliate/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AffiliateLoginForm() {
  const [state, formAction, pending] = useActionState(affiliateLogin, undefined);

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <div>
        <Label htmlFor="code" className="mb-2">
          Referral code
        </Label>
        <Input
          id="code"
          name="code"
          autoComplete="username"
          autoCapitalize="characters"
          spellCheck={false}
          required
          autoFocus
          placeholder="CHEFCLUB"
          className="font-mono uppercase"
          aria-invalid={!!state?.error}
        />
      </div>

      <div>
        <Label htmlFor="password" className="mb-2">
          Password
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={!!state?.error}
          aria-describedby={state?.error ? "affiliate-login-error" : undefined}
        />
      </div>

      {state?.error && (
        <p
          id="affiliate-login-error"
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
        >
          {state.error}
        </p>
      )}

      <Button type="submit" variant="warm" size="lg" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
