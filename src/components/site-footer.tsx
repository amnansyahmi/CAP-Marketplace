import Link from "next/link";

import { NewsletterForm } from "@/components/newsletter-form";
import { BRAND_TAGLINE } from "@/lib/products";
import { Separator } from "@/components/ui/separator";

export function SiteFooter() {
  return (
    <footer className="bg-[#1f201b] px-5 py-16 text-[#f5f0e7] lg:px-10">
      <div className="mx-auto grid max-w-[1440px] gap-10 md:grid-cols-[1.2fr_1fr] md:items-end">
        <div>
          <div className="font-serif text-3xl">Chef Ammar</div>
          <p className="mt-2 text-xs uppercase tracking-[.2em] text-white/65">{BRAND_TAGLINE}</p>
          <p className="mt-6 max-w-sm text-sm leading-6 text-white/60">
            Get new recipes and early access to seasonal blends, straight to your inbox.
          </p>
        </div>
        <NewsletterForm />
      </div>
      <Separator className="my-10 bg-white/12" />
      <div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-3 text-xs text-white/65 md:flex-row">
        <p>© 2026 Chef Ammar. All rights reserved.</p>
        <nav aria-label="Policies and help" className="flex flex-wrap gap-x-4 gap-y-1">
          {/* A shop that hides its delivery and returns terms is one people
              hesitate to buy from — and a payment gateway will look for these
              before approving a merchant account. */}
          <Link href="/shipping" className="transition-colors hover:text-white">
            Delivery
          </Link>
          <Link href="/returns" className="transition-colors hover:text-white">
            Returns
          </Link>
          <Link href="/terms" className="transition-colors hover:text-white">
            Terms
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-white">
            Privacy
          </Link>
          <Link href="/contact" className="transition-colors hover:text-white">
            Contact
          </Link>
          <Link href="/orders/find" className="transition-colors hover:text-white">
            Track order
          </Link>
          {/* Affiliates need a way in that does not depend on someone sending
              them a link every time. */}
          <Link href="/affiliate" className="transition-colors hover:text-white">
            Affiliate login
          </Link>
        </nav>
      </div>
    </footer>
  );
}
