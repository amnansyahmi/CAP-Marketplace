import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { updateFulfilment, updateStatus } from "@/app/admin/actions";
import { FulfilmentBadge, StatusBadge, formatDate } from "@/components/admin/order-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { FULFILMENT_STEPS, orderStore } from "@/lib/orders";
import { money } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}): Promise<Metadata> {
  const { reference } = await params;
  return { title: `Order ${reference}` };
}

export default async function AdminOrderPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const order = await orderStore.byReference(reference);
  if (!order) notFound();

  const canFulfil = order.status === "paid";
  const currentStep = FULFILMENT_STEPS.indexOf(order.fulfilment);

  return (
    <div className="mx-auto max-w-[1000px] px-5 py-10 lg:px-8 lg:py-14">
      <nav className="text-xs text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/admin/orders" className="hover:text-primary">
          Orders
        </Link>
        <span className="px-2">/</span>
        <span className="text-foreground">{order.reference}</span>
      </nav>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-3xl font-semibold tracking-tight">{order.reference}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Placed {formatDate(order.createdAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={order.status} />
          {canFulfil && <FulfilmentBadge fulfilment={order.fulfilment} />}
        </div>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="eyebrow">Items</h2>
          <ul className="mt-5 space-y-4">
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

          <dl className="space-y-2 text-sm">
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

          {order.paidAt && (
            <p className="mt-5 text-xs text-muted-foreground">Paid {formatDate(order.paidAt)}</p>
          )}
        </section>

        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="eyebrow">Ship to</h2>
            <address className="mt-4 text-sm not-italic leading-6">
              <span className="font-medium">{order.customer.fullName}</span>
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
            <Separator className="my-5" />
            <p className="text-sm leading-6">
              <a href={`mailto:${order.customer.email}`} className="text-primary hover:underline">
                {order.customer.email}
              </a>
              <br />
              <a href={`tel:${order.customer.phone.replace(/\s/g, "")}`} className="text-primary hover:underline">
                {order.customer.phone}
              </a>
            </p>
            {order.notes && (
              <>
                <Separator className="my-5" />
                <h3 className="eyebrow">Customer notes</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{order.notes}</p>
              </>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="eyebrow">Fulfilment</h2>

            {!canFulfil ? (
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                This order is {order.status.replace("_", " ")}. Only a paid order can be fulfilled.
              </p>
            ) : (
              <>
                <ol className="mt-5 space-y-2">
                  {FULFILMENT_STEPS.map((step, i) => (
                    <li key={step} className="flex items-center gap-3 text-sm">
                      <span
                        aria-hidden
                        className={`size-2 rounded-full ${i <= currentStep ? "bg-primary" : "bg-border"}`}
                      />
                      <span className={i <= currentStep ? "" : "text-muted-foreground"}>{step}</span>
                    </li>
                  ))}
                </ol>

                {order.fulfilmentUpdatedAt && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Updated {formatDate(order.fulfilmentUpdatedAt)}
                  </p>
                )}

                <form action={updateFulfilment} className="mt-6 space-y-3">
                  <input type="hidden" name="orderId" value={order.id} />
                  <div>
                    <Label htmlFor="trackingNumber" className="mb-2">
                      Tracking number
                    </Label>
                    <Input
                      id="trackingNumber"
                      name="trackingNumber"
                      defaultValue={order.trackingNumber ?? ""}
                      placeholder="Courier consignment number"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {FULFILMENT_STEPS.filter((s) => s !== order.fulfilment).map((step) => (
                      <Button
                        key={step}
                        type="submit"
                        name="fulfilment"
                        value={step}
                        variant={FULFILMENT_STEPS.indexOf(step) > currentStep ? "warm" : "outline"}
                        size="sm"
                      >
                        Mark {step}
                      </Button>
                    ))}
                  </div>
                </form>
              </>
            )}
          </section>

          {order.agentFee != null && (
            <section className="rounded-lg border border-border bg-card p-6">
              <h2 className="eyebrow">Agent fee</h2>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{order.agentName ?? "Agent"}</dt>
                  <dd className="font-semibold">{money(order.agentFee)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>{order.agentFeeStatus}</dd>
                </div>
              </dl>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Flat fee on every sale, separate from any affiliate commission.
              </p>
            </section>
          )}

          {order.affiliateCode && (
            <section className="rounded-lg border border-border bg-card p-6">
              <h2 className="eyebrow">Referred by</h2>
              <p className="mt-4 text-sm">
                <Link href={`/admin/affiliates/${order.affiliateCode}`} className="font-mono text-primary hover:underline">
                  {order.affiliateCode}
                </Link>
              </p>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Commission</dt>
                  <dd className="font-semibold">
                    {order.commissionAmount != null ? money(order.commissionAmount) : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Rate at order</dt>
                  <dd>{order.commissionRate != null ? `${(order.commissionRate * 100).toFixed(1)}%` : "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>{order.commissionStatus}</dd>
                </div>
              </dl>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Calculated on the subtotal, excluding delivery.
              </p>
            </section>
          )}

          {order.status === "pending_payment" && (
            <section className="rounded-lg border border-border bg-card p-6">
              <h2 className="eyebrow">Cancel</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Cancels an order that was never paid. A settled order cannot be cancelled here.
              </p>
              <form action={updateStatus} className="mt-4">
                <input type="hidden" name="orderId" value={order.id} />
                <input type="hidden" name="status" value="cancelled" />
                <Button type="submit" variant="outline" size="sm">
                  Cancel order
                </Button>
              </form>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
