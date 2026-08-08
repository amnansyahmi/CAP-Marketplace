"use client";

import Link from "next/link";
import { Menu } from "lucide-react";

import { CartSheet } from "@/components/cart-sheet";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export const navLinks = [
  { href: "/#collection", label: "Shop" },
  { href: "/#story", label: "Our kitchen" },
  { href: "/#guide", label: "How to cook" },
  { href: "/#faq", label: "FAQs" },
];

export function SiteHeader() {
  return (
    <>
      {/* First tab stop on every page, so keyboard users can bypass the nav. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-border focus:bg-background focus:px-5 focus:py-3 focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-black/8 bg-[#f5f0e7]/92 backdrop-blur-xl">
      <div className="mx-auto flex h-18 max-w-[1440px] items-center justify-between px-5 lg:px-10">
        <MobileNav />
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-serif text-[1.65rem] tracking-[-.04em]">Chef Ammar</span>
          <span className="text-[10px] font-semibold uppercase tracking-[.22em] text-muted-foreground">Product</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm lg:flex">
          {navLinks.map((l) => (
            <Link key={l.href} href={l.href} className="transition-colors hover:text-primary">
              {l.label}
            </Link>
          ))}
        </nav>
          <CartSheet />
        </div>
      </header>
    </>
  );
}

function MobileNav() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button className="lg:hidden" aria-label="Open menu">
          <Menu className="size-5 stroke-[1.6]" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="max-w-xs">
        <SheetHeader>
          <SheetTitle>Chef Ammar</SheetTitle>
          <SheetDescription>Masak Dari Hati, Masak Dengan Iman</SheetDescription>
        </SheetHeader>
        <nav className="flex flex-col">
          {navLinks.map((l) => (
            <SheetClose asChild key={l.href}>
              <Link
                href={l.href}
                className="border-b border-border px-6 py-5 font-serif text-2xl transition-colors hover:text-primary"
              >
                {l.label}
              </Link>
            </SheetClose>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
