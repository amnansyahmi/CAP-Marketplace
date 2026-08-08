import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { missingShopDetails, shopDetails, whatsappLink } from "@/lib/shop";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach Chef Ammar Product about an order, a delivery or anything else.",
};

/**
 * Contact details, not a contact form.
 *
 * A form that posts into a database nobody watches is worse than an email
 * address: the customer believes they have been heard and nobody has heard
 * them. Real addresses, or an honest statement that none are published yet.
 */
export default function ContactPage() {
  const details = shopDetails();
  const missing = missingShopDetails(details);
  const whatsapp = whatsappLink(details);
  const reachable = details.supportEmail || details.supportPhone || whatsapp;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="mx-auto max-w-[720px] px-5 py-16 lg:px-10 lg:py-24">
          <p className="eyebrow">{details.tradingName}</p>
          <h1 className="mt-4 font-serif text-5xl leading-[1.02] tracking-[-.04em] lg:text-6xl">
            Get in touch.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-8 text-muted-foreground">
            Questions about an order, a delivery, or which paste to start with — we would rather hear
            from you than have you guess.
          </p>

          {!reachable && (
            <p
              role="status"
              className="mt-10 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm leading-6 text-destructive"
            >
              <strong className="font-semibold">No contact details are published yet.</strong> The
              shop has not set its {missing.join(", ")}. A shop customers cannot reach is one they
              will not buy from, and a payment gateway will ask for these before approving the
              merchant account.
            </p>
          )}

          {reachable && (
            <dl className="mt-12 space-y-8">
              {details.supportEmail && (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">
                    Email
                  </dt>
                  <dd className="mt-2 font-serif text-2xl">
                    <a href={`mailto:${details.supportEmail}`} className="hover:text-primary">
                      {details.supportEmail}
                    </a>
                  </dd>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Best for anything about an existing order — include your reference.
                  </p>
                </div>
              )}

              {whatsapp && (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">
                    WhatsApp
                  </dt>
                  <dd className="mt-2 font-serif text-2xl">
                    <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                      {details.whatsapp}
                    </a>
                  </dd>
                </div>
              )}

              {details.supportPhone && !whatsapp && (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">
                    Phone
                  </dt>
                  <dd className="mt-2 font-serif text-2xl">
                    <a href={`tel:${details.supportPhone.replace(/\s/g, "")}`} className="hover:text-primary">
                      {details.supportPhone}
                    </a>
                  </dd>
                </div>
              )}

              {details.addressLines.length > 0 && (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">
                    Address
                  </dt>
                  <dd className="mt-2 text-base leading-7">
                    <address className="not-italic">
                      {details.addressLines.map((line, i) => (
                        <span key={line}>
                          {line}
                          {i < details.addressLines.length - 1 && <br />}
                        </span>
                      ))}
                    </address>
                  </dd>
                </div>
              )}
            </dl>
          )}

          <div className="mt-16 border-t border-border pt-8 text-sm leading-7 text-muted-foreground">
            <p>
              Looking for an order you placed?{" "}
              <Link href="/orders/find" className="text-primary hover:underline">
                Find it here
              </Link>{" "}
              with your reference and email address.
            </p>
            <p className="mt-2">
              Delivery times and charges are on the{" "}
              <a href="/shipping" className="text-primary hover:underline">
                delivery page
              </a>
              . Returns and refunds are on the{" "}
              <a href="/returns" className="text-primary hover:underline">
                returns page
              </a>
              .
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
