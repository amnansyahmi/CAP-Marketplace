"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

/** The origin never changes within a page's life, so nothing to subscribe to. */
const noSubscribe = () => () => {};
const clientOrigin = () => window.location.origin;

/**
 * The affiliate's link, with a copy button.
 *
 * `fallback` is rendered on the server so the link is correct and selectable
 * before hydration. On the client the origin is replaced with the one actually
 * being browsed, which keeps the link right on a preview deployment or a
 * laptop, where `NEXT_PUBLIC_SITE_URL` is either unset or points somewhere else.
 */
export function ReferralLink({ code, fallback }: { code: string; fallback: string }) {
  // Reading `window` through the store rather than an effect: React hands back
  // the server snapshot for the hydrating render and the real origin straight
  // after, with no intermediate render carrying a value we know is stale.
  const origin = useSyncExternalStore(noSubscribe, clientOrigin, () => null);
  const link = origin ? `${origin}/?ref=${code}` : fallback;

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard access can be refused (insecure origin, denied permission).
      // The link is on screen and selectable, so there is nothing to recover
      // from — just don't claim it was copied.
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-background px-3 py-2.5 font-mono text-xs">
        {link}
      </code>
      <Button type="button" variant="outline" onClick={copy} className="shrink-0">
        {copied ? "Copied" : "Copy link"}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Referral link copied to clipboard" : ""}
      </span>
    </div>
  );
}
