import Link from "next/link";

import { BRAND_TAGLINE } from "@/lib/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
        {/*
          Not wired to a mailing list yet. `method="dialog"` keeps the browser
          from GET-submitting to the current URL, which reloaded the page and
          wrote the subscriber's email into the address bar and history.
          TODO: post to a real subscribe endpoint, or drop the form until there
          is one — a button that silently does nothing is its own problem.
        */}
        <form method="dialog" className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Label htmlFor="newsletter-email" className="sr-only">
              Email address
            </Label>
            <Input
              id="newsletter-email"
              name="email"
              type="email"
              required
              placeholder="you@email.com"
              className="border-white/20 bg-white/5 text-white placeholder:text-white/55"
            />
          </div>
          <Button type="submit" variant="warm">
            Subscribe
          </Button>
        </form>
      </div>
      <Separator className="my-10 bg-white/12" />
      <div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-3 text-xs text-white/65 md:flex-row">
        <p>© 2026 Chef Ammar. All rights reserved.</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {/* Affiliates need a way in that does not depend on someone sending
              them a link every time. */}
          <Link href="/affiliate" className="transition-colors hover:text-white">
            Affiliate login
          </Link>
          <span>Payments secured by CHIP.</span>
        </p>
      </div>
    </footer>
  );
}
