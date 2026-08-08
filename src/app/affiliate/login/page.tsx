import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { affiliateDemoLogin } from "@/app/affiliate/actions";
import { AffiliateLoginForm } from "@/app/affiliate/login/login-form";
import { affiliateAuthConfig, currentAffiliate } from "@/lib/affiliate/session";
import { affiliateStore } from "@/lib/affiliates";
import { adminAuthBypassed } from "@/lib/environment";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Affiliate sign in · Chef Ammar",
  robots: { index: false, follow: false },
};

export default async function AffiliateLoginPage() {
  if (await currentAffiliate()) redirect("/affiliate");

  const config = affiliateAuthConfig();
  const demo = adminAuthBypassed();
  const demoAffiliates = demo && config.enabled ? (await affiliateStore.list()).filter((a) => a.active) : [];

  return (
    <main className="grid min-h-screen place-items-center bg-background px-5 py-16 text-foreground">
      <div className="w-full max-w-sm">
        <Link href="/" className="eyebrow">
          Chef Ammar
        </Link>
        <h1 className="mt-3 font-serif text-5xl tracking-[-.04em]">Affiliates.</h1>

        {config.enabled ? (
          <>
            <p className="mt-5 text-sm leading-6 text-muted-foreground">
              Sign in to see the orders your link brought in and what you have earned.
            </p>

            {demo ? (
              <div className="mt-7 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                <p className="text-xs font-semibold text-destructive">Demo mode — no password needed</p>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  Pick an affiliate to see the portal as they would.
                </p>
                <div className="mt-4 space-y-2">
                  {demoAffiliates.map((affiliate) => (
                    <form key={affiliate.id} action={affiliateDemoLogin}>
                      <input type="hidden" name="code" value={affiliate.code} />
                      <Button type="submit" variant="outline" className="w-full justify-between">
                        <span>{affiliate.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{affiliate.code}</span>
                      </Button>
                    </form>
                  ))}
                  {demoAffiliates.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No active affiliates yet. Add one in the admin.
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            <AffiliateLoginForm />

            <p className="mt-6 text-xs leading-5 text-muted-foreground">
              No password yet? Ask Chef Ammar to set one for you — affiliate accounts are created by
              the shop.
            </p>
          </>
        ) : (
          <div className="mt-6 rounded-md border border-border bg-muted/60 p-4 text-sm leading-6 text-muted-foreground">
            <p className="font-semibold text-foreground">The affiliate portal is disabled.</p>
            <p className="mt-2">
              {config.reason}. Set <code className="font-mono text-xs">AFFILIATE_SESSION_SECRET</code>{" "}
              to enable it.
            </p>
            <p className="mt-3 text-xs">
              It stays closed until then, so an unset secret can never leave sales figures reachable.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
