import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/admin/login/login-form";
import { adminConfig, isAdmin } from "@/lib/admin/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin sign in", robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
  if (await isAdmin()) redirect("/admin");
  const config = adminConfig();

  return (
    <main className="grid min-h-screen place-items-center bg-background px-5 py-16 text-foreground">
      <div className="w-full max-w-sm">
        <p className="eyebrow">Chef Ammar</p>
        <h1 className="mt-3 font-serif text-5xl tracking-[-.04em]">Admin.</h1>

        {config.enabled ? (
          <>
            <p className="mt-5 text-sm leading-6 text-muted-foreground">
              Sign in to manage orders.
            </p>
            <LoginForm />
          </>
        ) : (
          <div className="mt-6 rounded-md border border-border bg-muted/60 p-4 text-sm leading-6 text-muted-foreground">
            <p className="font-semibold text-foreground">Admin is disabled.</p>
            <p className="mt-2">
              {config.reason}. Set <code className="font-mono text-xs">ADMIN_PASSWORD</code> and{" "}
              <code className="font-mono text-xs">ADMIN_SESSION_SECRET</code> to enable it.
            </p>
            <p className="mt-3 text-xs">
              The admin area stays closed until both are configured, so an unset password can never
              leave customer details reachable.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
