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
          <p className="mt-2 text-xs uppercase tracking-[.2em] text-white/45">{BRAND_TAGLINE}</p>
          <p className="mt-6 max-w-sm text-sm leading-6 text-white/60">
            Get new recipes and early access to seasonal blends, straight to your inbox.
          </p>
        </div>
        <form className="flex flex-col gap-3 sm:flex-row">
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
              className="border-white/20 bg-white/5 text-white placeholder:text-white/40"
            />
          </div>
          <Button type="submit" variant="warm">
            Subscribe
          </Button>
        </form>
      </div>
      <Separator className="my-10 bg-white/12" />
      <div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-3 text-xs text-white/45 md:flex-row">
        <p>© 2026 Chef Ammar. All rights reserved.</p>
        <p>Payments secured by CHIP.</p>
      </div>
    </footer>
  );
}
