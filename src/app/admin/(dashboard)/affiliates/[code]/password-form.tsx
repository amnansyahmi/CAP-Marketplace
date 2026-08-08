"use client";

import { useActionState } from "react";

import { setAffiliatePassword } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH } from "@/lib/affiliate/password-rules";

export function PasswordForm({
  affiliateId,
  code,
  hasPassword,
}: {
  affiliateId: string;
  code: string;
  hasPassword: boolean;
}) {
  const [state, formAction, pending] = useActionState(setAffiliatePassword, undefined);

  return (
    <>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {hasPassword
          ? "They can sign in at /affiliate to see their own orders and earnings."
          : "No password set, so they cannot open the portal yet."}
      </p>

      <form action={formAction} className="mt-5 space-y-3">
        <input type="hidden" name="affiliateId" value={affiliateId} />
        <input type="hidden" name="code" value={code} />
        <Label htmlFor="affiliate-password">{hasPassword ? "New password" : "Password"}</Label>
        <Input
          id="affiliate-password"
          name="password"
          type="text"
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="off"
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          aria-invalid={!!state?.error}
          aria-describedby={state?.error || state?.ok ? "affiliate-password-status" : undefined}
        />
        <p className="text-xs leading-5 text-muted-foreground">
          Shown as plain text so you can copy it and send it to them. It is hashed before it is
          stored, so this is the only time it is readable.
        </p>

        {(state?.error || state?.ok) && (
          <p
            id="affiliate-password-status"
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

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? "Saving…" : hasPassword ? "Replace password" : "Set password"}
          </Button>
          {hasPassword && (
            <Button type="submit" name="clear" value="true" variant="ghost" size="sm" disabled={pending}>
              Remove access
            </Button>
          )}
        </div>
      </form>
    </>
  );
}
