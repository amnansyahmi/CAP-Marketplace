import type { Metadata } from "next";

import { CheckoutForm } from "@/components/checkout-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Complete your Chef Ammar Product order.",
};

export default function CheckoutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="mx-auto max-w-[1240px] px-5 py-14 lg:px-10 lg:py-20">
          <p className="eyebrow">Almost there</p>
          <h1 className="mt-3 font-serif text-5xl tracking-[-.04em] lg:text-7xl">Checkout.</h1>
          <div className="mt-14">
            <CheckoutForm />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
