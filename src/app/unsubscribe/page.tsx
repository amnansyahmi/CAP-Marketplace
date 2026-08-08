import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { unsubscribe, verifyUnsubscribeToken } from "@/lib/subscribers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

/**
 * One-click unsubscribe from an emailed link.
 *
 * Acts on load rather than asking for a confirmation click. Someone who
 * followed an unsubscribe link has already decided; making them confirm is a
 * dark pattern, and it is the sort of friction that turns an unsubscribe into a
 * spam complaint.
 *
 * The link is signed, so it can only ever remove the address it was issued for.
 * Without that, editing the address in the URL would let anyone unsubscribe
 * anyone.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; t?: string }>;
}) {
  const { email, t } = await searchParams;

  const valid = email ? verifyUnsubscribeToken(email, t) : false;
  const removed = valid && email ? await unsubscribe(email) : false;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="mx-auto max-w-[560px] px-5 py-20 lg:px-10 lg:py-28">
          {valid ? (
            <>
              <p className="eyebrow">Newsletter</p>
              <h1 className="mt-4 font-serif text-5xl leading-[1.02] tracking-[-.04em]">
                {removed ? "You are unsubscribed." : "You were already unsubscribed."}
              </h1>
              <p className="mt-6 text-base leading-8 text-muted-foreground">
                {removed
                  ? "We have taken you off the list. You will not get any more newsletters from us."
                  : "That address is not on our list, so there was nothing to remove."}
              </p>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">
                This does not affect emails about orders you place — those are part of buying
                something, and we will still send them.
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow">Newsletter</p>
              <h1 className="mt-4 font-serif text-5xl leading-[1.02] tracking-[-.04em]">
                That link did not work.
              </h1>
              <p className="mt-6 text-base leading-8 text-muted-foreground">
                It may have been copied incompletely. Reply to any email from us and we will take you
                off the list by hand.
              </p>
            </>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
