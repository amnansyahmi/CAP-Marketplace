import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { missingShopDetails, shopDetails } from "@/lib/shop";

/**
 * The shell every policy page shares.
 *
 * Carries one deliberate piece of honesty: when the business details are not
 * configured, the page says so at the top instead of publishing a policy that
 * names nobody. A returns policy from an unnamed seller with no address is not
 * a policy, and a customer reading one has been told nothing.
 */
export function PolicyPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** Date the wording last changed, so a customer can tell what they agreed to. */
  updated: string;
  children: React.ReactNode;
}) {
  const details = shopDetails();
  const missing = missingShopDetails(details);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <article className="mx-auto max-w-[720px] px-5 py-16 lg:px-10 lg:py-24">
          <p className="eyebrow">{details.tradingName}</p>
          <h1 className="mt-4 font-serif text-5xl leading-[1.02] tracking-[-.04em] lg:text-6xl">{title}</h1>
          <p className="mt-5 text-sm text-muted-foreground">Last updated {updated}</p>

          {missing.length > 0 && (
            <p
              role="status"
              className="mt-8 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm leading-6 text-destructive"
            >
              <strong className="font-semibold">This policy is incomplete.</strong> The shop has not
              set its {missing.join(", ")}. Until it does, this page cannot say who the seller is —
              which is the first thing a customer, and a payment gateway, will look for.
            </p>
          )}

          <div className="policy mt-10">{children}</div>

          <p className="mt-16 border-t border-border pt-8 text-sm leading-6 text-muted-foreground">
            Questions about this page?{" "}
            <Link href="/contact" className="text-primary hover:underline">
              Get in touch
            </Link>
            .
          </p>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
