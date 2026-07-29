import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { chipConfig } from "@/lib/chip";
import { getMailer } from "@/lib/notifications/mailer";
import { ORDER_COOKIE, cookiePlacedThisOrder, verifyOrderToken } from "@/lib/order-access";
import { orderStore, type OrderStatus } from "@/lib/orders";
import { money } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your order" };

const STATUS_COPY: Record<OrderStatus, { heading: string; body: string }> = {
  paid: {
    heading: "Thank you — your order is confirmed.",
    body: "We have received your payment and your jars are being packed. A confirmation email is on its way.",
  },
  pending_payment: {
    heading: "Your order is awaiting payment.",
    body: "We have reserved your order. Once the payment clears, we will confirm it by email.",
  },
  failed: {
    heading: "That payment did not go through.",
    body: "No money has been taken. You can head back to the shop and try again.",
  },
  cancelled: {
    heading: "This order was cancelled.",
    body: "Nothing has been charged. Your bag is still waiting whenever you are.",
  },
};

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ payment?: string; t?: string }>;
}) {
  const { reference } = await params;
  const { payment, t } = await searchParams;
  const order = await orderStore.byReference(reference);
  if (!order) notFound();

  // Knowing the reference is not enough: this page carries a home address and
  // a phone number. Either the signed link we emailed, or the browser that
  // placed the order.
  const jar = await cookies();
  const permitted =
    verifyOrderToken(order.reference, t) ||
    cookiePlacedThisOrder(jar.get(ORDER_COOKIE)?.value, order.reference);
  // Same response as a reference that does not exist, so this page cannot be
  // used to confirm which references are real.
  if (!permitted) notFound();

  // A `?payment=failed` return from the gateway wins over a still-pending record.
  const status: OrderStatus = payment === "failed" && order.status === "pending_payment" ? "failed" : order.status;
  const copy = STATUS_COPY[status];
  const { isLive } = chipConfig();
  const mailDriver = getMailer().name;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="outline-none">
      <section className="mx-auto max-w-[860px] px-5 py-16 lg:px-10 lg:py-24">
        <p className="eyebrow">Order {order.reference}</p>
        <h1 className="mt-4 font-serif text-5xl leading-[1.02] tracking-[-.04em] lg:text-6xl">{copy.heading}</h1>
        <p className="mt-6 max-w-xl text-base leading-8 text-muted-foreground">{copy.body}</p>

        {status === "paid" && mailDriver !== "resend" && (
          <p className="mt-6 rounded-md border border-border bg-muted/60 p-4 text-xs leading-6 text-muted-foreground">
            <strong className="font-semibold">No email was sent.</strong> This environment has no mail
            provider configured, so the confirmation was written to the server console instead. Set{" "}
            <code className="font-mono">RESEND_API_KEY</code> and <code className="font-mono">MAIL_FROM</code>{" "}
            to send real email.
          </p>
        )}

        {status === "paid" && !isLive && (
          <p className="mt-6 rounded-md border border-border bg-muted/60 p-4 text-xs leading-6 text-muted-foreground">
            <strong className="font-semibold">Simulated payment.</strong> CHIP credentials are not configured on this
            environment, so this order was marked paid without money changing hands. Set{" "}
            <code className="font-mono">CHIP_BRAND_ID</code> and <code className="font-mono">CHIP_SECRET_KEY</code> to
            take real payments.
          </p>
        )}

        <div className="mt-12 rounded-lg border border-border bg-card p-6 lg:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="eyebrow">Order summary</h2>
            <Badge variant={status === "paid" ? "default" : "outline"}>{status.replace("_", " ")}</Badge>
          </div>

          <ul className="mt-6 space-y-4">
            {order.items.map((item) => (
              <li key={item.productId} className="flex justify-between gap-4 text-sm">
                <div>
                  <p className="font-serif text-lg leading-tight">{item.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.quantity} × {money(item.unitPrice)}
                  </p>
                </div>
                <strong>{money(item.lineTotal)}</strong>
              </li>
            ))}
          </ul>

          <Separator className="my-6" />

          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{money(order.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Delivery</dt>
              <dd>{order.shipping === 0 ? <span className="text-primary">Free</span> : money(order.shipping)}</dd>
            </div>
            <div className="flex justify-between pt-2">
              <dt className="font-semibold">Total</dt>
              <dd className="font-serif text-2xl">{money(order.total)}</dd>
            </div>
          </dl>

          <Separator className="my-6" />

          <div className="grid gap-8 text-sm sm:grid-cols-2">
            <div>
              <h3 className="eyebrow">Delivering to</h3>
              <address className="mt-3 not-italic leading-6 text-muted-foreground">
                {order.customer.fullName}
                <br />
                {order.address.line1}
                <br />
                {order.address.line2 && (
                  <>
                    {order.address.line2}
                    <br />
                  </>
                )}
                {order.address.postcode} {order.address.city}
                <br />
                {order.address.state}
              </address>
            </div>
            <div>
              <h3 className="eyebrow">Contact</h3>
              <p className="mt-3 leading-6 text-muted-foreground">
                {order.customer.email}
                <br />
                {order.customer.phone}
              </p>
              {order.notes && (
                <>
                  <h3 className="eyebrow mt-6">Notes</h3>
                  <p className="mt-3 leading-6 text-muted-foreground">{order.notes}</p>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-4">
          <Button asChild variant="warm" size="lg">
            <Link href="/#collection">Continue shopping</Link>
          </Button>
          {(status === "failed" || status === "pending_payment") && order.paymentUrl && (
            <Button asChild variant="outline" size="lg">
              <a href={order.paymentUrl}>Try the payment again</a>
            </Button>
          )}
        </div>
      </section>
      </main>
      <SiteFooter />
    </div>
  );
}
