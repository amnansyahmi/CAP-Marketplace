import Link from "next/link";
import type { Metadata } from "next";

import { affiliateLogout } from "@/app/affiliate/actions";
import { requireAffiliate } from "@/lib/affiliate/session";
import { Button } from "@/components/ui/button";

// Never cached or prerendered: every page here is scoped to one affiliate, so a
// cached response would be the wrong affiliate's earnings.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Affiliate", template: "%s · Chef Ammar Affiliates" },
  robots: { index: false, follow: false },
};

export default async function AffiliatePortalLayout({ children }: { children: React.ReactNode }) {
  const affiliate = await requireAffiliate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-[#f5f0e7]/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1100px] items-center justify-between gap-6 px-5 lg:px-8">
          <div className="flex items-baseline gap-6">
            <Link href="/affiliate" className="flex items-baseline gap-2">
              <span className="font-serif text-xl tracking-[-.03em]">Chef Ammar</span>
              <span className="text-[10px] font-semibold uppercase tracking-[.22em] text-muted-foreground">
                Affiliate
              </span>
            </Link>
            <nav className="hidden items-center gap-5 text-sm sm:flex">
              <Link href="/affiliate" className="transition-colors hover:text-primary">
                Dashboard
              </Link>
              <Link href="/" className="transition-colors hover:text-primary">
                View shop
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-muted-foreground sm:inline">{affiliate.name}</span>
            <form action={affiliateLogout}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="outline-none">
        {children}
      </main>
    </div>
  );
}
