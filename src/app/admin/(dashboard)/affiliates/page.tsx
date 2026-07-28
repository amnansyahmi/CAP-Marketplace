import Link from "next/link";
import type { Metadata } from "next";

import { NewAffiliateForm } from "@/app/admin/(dashboard)/affiliates/new-affiliate-form";
import { Badge } from "@/components/ui/badge";
import { affiliateStore } from "@/lib/affiliates";
import { money } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Affiliates" };

const percent = (rate: number) => `${(rate * 100).toFixed(rate * 100 % 1 === 0 ? 0 : 1)}%`;

export default async function AffiliatesPage() {
  const summaries = await affiliateStore.summaries();
  const totalOwed = summaries.reduce((sum, s) => sum + s.commissionOwed, 0);
  const totalPaid = summaries.reduce((sum, s) => sum + s.commissionPaid, 0);

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-10 lg:px-8 lg:py-14">
      <p className="eyebrow">Affiliates</p>
      <h1 className="mt-3 font-serif text-5xl tracking-[-.04em]">Who is selling for you.</h1>

      <dl className="mt-10 grid gap-4 sm:grid-cols-3">
        <Stat label="Affiliates" value={String(summaries.length)} />
        <Stat label="Commission owed" value={money(totalOwed)} hint="Earned, not yet paid out" primary />
        <Stat label="Commission paid" value={money(totalPaid)} />
      </dl>

      <div className="mt-14 grid gap-10 lg:grid-cols-[1.5fr_1fr] lg:gap-14">
        <div>
          <h2 className="font-serif text-3xl tracking-[-.03em]">All affiliates</h2>
          <div className="mt-6">
            {summaries.length === 0 ? (
              <div className="rounded-lg border border-border bg-card p-12 text-center">
                <p className="font-serif text-2xl">No affiliates yet.</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Add one and share their referral link to start tracking commission.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {["Code", "Name", "Rate", "Orders", "Sales", "Owed"].map((h) => (
                        <th
                          key={h}
                          scope="col"
                          className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summaries.map((s) => (
                      <tr key={s.affiliate.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/affiliates/${s.affiliate.code}`}
                            className="font-mono text-xs font-semibold text-primary hover:underline"
                          >
                            {s.affiliate.code}
                          </Link>
                          {!s.affiliate.active && (
                            <Badge variant="outline" className="ml-2">
                              inactive
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{s.affiliate.name}</div>
                          <div className="text-xs text-muted-foreground">{s.affiliate.email}</div>
                        </td>
                        <td className="px-4 py-3">{percent(s.affiliate.commissionRate)}</td>
                        <td className="px-4 py-3">{s.orderCount}</td>
                        <td className="whitespace-nowrap px-4 py-3">{money(s.salesSubtotal)}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-semibold">{money(s.commissionOwed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div>
          <h2 className="font-serif text-3xl tracking-[-.03em]">Add an affiliate</h2>
          <NewAffiliateForm />
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
        <span className={`block font-serif text-4xl tracking-[-.03em] ${primary ? "text-primary" : ""}`}>{value}</span>
        {hint && <span className="mt-2 block text-xs text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
}
