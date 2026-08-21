"use client";

import { useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";

import { SHOP_NOW_URL } from "@/lib/shop-now";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * "Shop now" — opens the bcl.my order form in a webview over the shop.
 *
 * Ordering happens on a hosted form, but sending buyers off to another domain
 * mid-visit loses them; the page they were reading is gone and the way back is
 * the browser's back button. Framing the form keeps the shop underneath, so
 * closing the webview returns them exactly where they were.
 *
 * Takes the same props as any other button, so it can sit in the hero, the
 * header or anywhere else a call to action belongs.
 */
export function ShopNowButton({ children = "Shop now", ...props }: ButtonProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button {...props}>{children}</Button>
      </DialogTrigger>
      {/* Near-fullscreen: an order form needs the room, and on a phone anything
          less than the whole screen makes the fields fight for space. */}
      <DialogContent
        showClose={false}
        className="h-[100dvh] w-screen max-w-none grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[92vh] sm:w-[calc(100vw-3rem)] sm:max-w-4xl sm:rounded-lg sm:border"
      >
        {/* Mounted only while the dialog is open, so the frame — and its
            loading state — starts clean on every visit rather than showing the
            previous session's form. */}
        <ShopNowFrame />
      </DialogContent>
    </Dialog>
  );
}

function ShopNowFrame() {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-background px-4 py-3">
        <div className="min-w-0">
          <DialogTitle className="truncate text-xl">Shop now</DialogTitle>
          <DialogDescription className="sr-only">
            The Chef Ammar order form, loaded from chefammar.bcl.my inside this page.
          </DialogDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Always offered, not just on failure: some browsers and privacy
              settings refuse third-party frames outright, and when they do the
              frame simply comes up blank with nothing to click. */}
          <Button asChild variant="ghost" size="sm">
            <a href={SHOP_NOW_URL} target="_blank" rel="noopener noreferrer">
              <span className="hidden sm:inline">Open in new tab</span>
              <ExternalLink className="size-4" />
              <span className="sr-only sm:hidden">Open the order form in a new tab</span>
            </a>
          </Button>
          <DialogClose className="grid size-9 place-items-center rounded-md border border-border bg-background transition-colors hover:bg-muted">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>
      </div>
      <div className="relative bg-muted">
        {!loaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            <span>Loading the order form&hellip;</span>
          </div>
        )}
        <iframe
          src={SHOP_NOW_URL}
          title="Chef Ammar order form"
          onLoad={() => setLoaded(true)}
          // No `sandbox`: the form is a first-party service of the same shop and
          // needs its own scripts, cookies and payment redirects to work.
          allow="payment; clipboard-write"
          referrerPolicy="strict-origin-when-cross-origin"
          className="size-full border-0"
        />
      </div>
    </>
  );
}
