"use client";

import { useActionState } from "react";

import { login } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <form action={formAction} className="mt-8 space-y-4">
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
          autoFocus
          aria-invalid={!!state?.error}
          aria-describedby={state?.error ? "login-error" : undefined}
        />
      </div>

      {state?.error && (
        <p id="login-error" role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" variant="warm" size="lg" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
