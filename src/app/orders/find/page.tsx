import type { Metadata } from "next";

import { FindOrderForm } from "@/app/orders/find/find-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Find your order",
  description: "Look up a Chef Ammar Product order with your reference and email address.",
  // Nothing to index: the page is a form, and its results are private.
  robots: { index: false, follow: true },
};

export default function FindOrderPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="mx-auto max-w-[520px] px-5 py-16 lg:px-10 lg:py-24">
          <p className="eyebrow">Your order</p>
          <h1 className="mt-4 font-serif text-5xl leading-[1.02] tracking-[-.04em]">
            Find your order.
          </h1>
          <p className="mt-6 text-base leading-8 text-muted-foreground">
            Lost the email? Enter your order reference and the email address you used, and we will
            take you straight to it. No account needed.
          </p>

          <FindOrderForm />

          <p className="mt-10 border-t border-border pt-8 text-sm leading-7 text-muted-foreground">
            We ask for both because your order page shows your delivery address and phone number — the
            reference on its own should not be enough to open it.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
