import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { payOutAffiliate, setAffiliateActive, setAffiliateRate } from "@/app/admin/actions";
import { formatDate } from "@/components/admin/order-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { affiliateStore } from "@/lib/affiliates";
import { orderStore } from "@/lib/orders";
import { money } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  return { title: `Affiliate ${code}` };
}

export default async function AffiliatePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const summary = await affiliateStore.summary(code);
  if (!summary) notFound();

  const { affiliate } = summary;
  const { orders } = await orderStore.list({ limit: 100 });
  const theirs = orders.filter((o) => o.affiliateId === affiliate.id);

  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://your-domain.my";
  const referralLink = `${base}/?ref=${affiliate.code}`;
  const ratePercent = affiliate.commissionRate * 100;

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-10 lg:px-8 lg:py-14">
      <nav className="text-xs text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/admin/affiliates" className="hover:text-primary">
          Affiliates
        </Link>
        <span className="px-2">/</span>
        <span className="text-foreground">{affiliate.code}</span>
      </nav>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-5xl tracking-[-.04em]">{affiliate.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {affiliate.email}
            {affiliate.phone ? ` · ${affiliate.phone}` : ""} · joined {formatDate(affiliate.createdAt)}
          </p>
        </div>
        <Badge variant={affiliate.active ? "default" : "outline"}>
          {affiliate.active ? "active" : "inactive"}
        </Badge>
      </div>

      <dl className="mt-10 grid gap-4 sm:grid-cols-4">
        <Stat label="Paid orders" value={String(summary.orderCount)} />
        <Stat label="Sales" value={money(summary.salesSubtotal)} hint="Subtotal, excluding delivery" />
        <Stat label="Owed" value={money(summary.commissionOwed)} primary />
        <Stat label="Paid out" value={money(summary.commissionPaid)} />
      </dl>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="eyebrow">Attributed orders</h2>
          {theirs.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No orders through this link yet.</p>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {["Order", "Status", "Subtotal", "Commission"].map((h) => (
                      <th key={h} scope="col" className="pb-2 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {theirs.map((o) => (
                    <tr key={o.id} className="border-b border-border last:border-b-0">
                      <td className="py-3">
                        <Link href={`/admin/orders/${o.reference}`} className="font-mono text-xs text-primary hover:underline">
                          {o.reference}
                        </Link>
                      </td>
                      <td className="py-3">
                        <Badge variant={o.commissionStatus === "paid" ? "secondary" : "outline"}>
                          {o.commissionStatus}
                        </Badge>
                      </td>
                      <td className="py-3">{money(o.subtotal)}</td>
                      <td className="py-3 font-semibold">
                        {o.commissionAmount != null ? money(o.commissionAmount) : "—"}
                        {o.commissionRate != null && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            @ {(o.commissionRate * 100).toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="eyebrow">Referral link</h2>
            <p className="mt-4 break-all rounded-md border border-border bg-muted/50 p-3 font-mono text-xs">
              {referralLink}
            </p>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Anyone arriving through this link is attributed to {affiliate.name} for 30 days.
            </p>
          </section>

          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="eyebrow">Pay out</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Marks all earned, unpaid commission as paid. Only commission on orders that were actually
              paid is included.
            </p>
            <p className="mt-4 font-serif text-3xl">{money(summary.commissionOwed)}</p>
            <form action={payOutAffiliate} className="mt-4">
              <input type="hidden" name="affiliateId" value={affiliate.id} />
              <input type="hidden" name="code" value={affiliate.code} />
              <Button type="submit" variant="warm" size="sm" disabled={summary.commissionOwed <= 0}>
                Mark {money(summary.commissionOwed)} paid
              </Button>
            </form>
          </section>

          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="eyebrow">Settings</h2>

            <form action={setAffiliateRate} className="mt-5 space-y-3">
              <input type="hidden" name="affiliateId" value={affiliate.id} />
              <Label htmlFor="commissionPercent">Commission %</Label>
              <Input
                id="commissionPercent"
                name="commissionPercent"
                type="number"
                min="0"
                max="100"
                step="0.5"
                defaultValue={ratePercent}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Applies to future orders only. Orders already placed keep the rate they were made at.
              </p>
              <Button type="submit" variant="outline" size="sm">
                Update rate
              </Button>
            </form>

            <Separator className="my-6" />

            <form action={setAffiliateActive}>
              <input type="hidden" name="affiliateId" value={affiliate.id} />
              <input type="hidden" name="active" value={String(!affiliate.active)} />
              <Button type="submit" variant="outline" size="sm">
                {affiliate.active ? "Deactivate" : "Reactivate"}
              </Button>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                A deactivated code stops earning commission on new orders. Commission already earned is
                unaffected.
              </p>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, primary }: { label: string; value: string; hint?: string; primary?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <dt className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">{label}</dt>
      <dd className="mt-3">
        <span className={`block font-serif text-3xl tracking-[-.03em] ${primary ? "text-primary" : ""}`}>{value}</span>
        {hint && <span className="mt-2 block text-xs text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
}
