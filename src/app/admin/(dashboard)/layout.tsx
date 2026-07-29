import Link from "next/link";
import type { Metadata } from "next";

import { logout } from "@/app/admin/actions";
import { requireAdmin } from "@/lib/admin/session";
import { adminAuthBypassed } from "@/lib/environment";
import { Button } from "@/components/ui/button";

// Never cached or prerendered: these pages contain customer personal data and
// the session must be checked on every request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Chef Ammar Admin" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Guards navigation into any page in this group. Server actions repeat the
  // check for themselves — see src/app/admin/actions.ts.
  await requireAdmin();
  const openToAnyone = adminAuthBypassed();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {openToAnyone && (
        // Deliberately not dismissible. Anyone with the URL is reading customer
        // names, phone numbers and addresses right now, and the person showing
        // the demo is the one who has to remember to turn this off.
        <div
          role="alert"
          className="bg-destructive px-5 py-2.5 text-center text-xs font-semibold text-destructive-foreground lg:px-8"
        >
          Demo mode — the sign-in is switched off, so anyone with this link can open the admin area.
          Unset ADMIN_DEMO_MODE before taking real orders.
        </div>
      )}
      <header className="sticky top-0 z-40 border-b border-border bg-[#f5f0e7]/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-6 px-5 lg:px-8">
          <div className="flex items-baseline gap-6">
            <Link href="/admin" className="flex items-baseline gap-2">
              <span className="font-serif text-xl tracking-[-.03em]">Chef Ammar</span>
              <span className="text-[10px] font-semibold uppercase tracking-[.22em] text-muted-foreground">
                Admin
              </span>
            </Link>
            <nav className="hidden items-center gap-5 text-sm sm:flex">
              <Link href="/admin" className="transition-colors hover:text-primary">
                Overview
              </Link>
              <Link href="/admin/orders" className="transition-colors hover:text-primary">
                Orders
              </Link>
              <Link href="/admin/stock" className="transition-colors hover:text-primary">
                Stock
              </Link>
              <Link href="/admin/discounts" className="transition-colors hover:text-primary">
                Discounts
              </Link>
              <Link href="/admin/affiliates" className="transition-colors hover:text-primary">
                Affiliates
              </Link>
              <Link href="/" className="transition-colors hover:text-primary">
                View shop
              </Link>
            </nav>
          </div>
          {/* No session to end in demo mode, and signing out would only bounce
              off the login page straight back to here. */}
          {!openToAnyone && (
            <form action={logout}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          )}
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="outline-none">
        {children}
      </main>
    </div>
  );
}
