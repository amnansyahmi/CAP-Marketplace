import Link from "next/link";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { listSubscribers } from "@/lib/subscribers";
import { lowStock, salesReport } from "@/lib/reporting";
import { money } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reports" };

const WINDOWS = [7, 30, 90] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const requested = Number(params.days);
  const days = (WINDOWS as readonly number[]).includes(requested) ? requested : 30;

  const [report, low, subscribers] = await Promise.all([
    salesReport(days),
    lowStock(),
    listSubscribers({ limit: 1 }),
  ]);

  const change =
    report.previousRevenue > 0
      ? Math.round(((report.revenue - report.previousRevenue) / report.previousRevenue) * 100)
      : null;

  const peak = Math.max(1, ...report.days.map((d) => d.revenue));

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-10 lg:px-8 lg:py-14">
      <p className="eyebrow">Reports</p>
      <h1 className="mt-3 font-serif text-5xl tracking-[-.04em]">How the shop is doing.</h1>

      <nav aria-label="Reporting period" className="mt-8 flex gap-2">
        {WINDOWS.map((window) => (
          <Link
            key={window}
            href={`/admin/reports?days=${window}`}
            aria-current={window === days ? "page" : undefined}
            className={`rounded-md border px-3.5 py-1.5 text-sm transition-colors ${
              window === days
                ? "border-primary bg-primary/5 text-primary"
                : "border-border hover:border-primary/50"
            }`}
          >
            {window} days
          </Link>
        ))}
      </nav>

      {low.length > 0 && (
        <p
          role="status"
          className="mt-8 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm leading-6 text-destructive"
        >
          <strong className="font-semibold">Running low.</strong>{" "}
          {low.map((item) => `${item.name} (${item.available} left)`).join(", ")}.{" "}
          <Link href="/admin/products" className="underline">
            Update stock
          </Link>
          .
        </p>
      )}

      <dl className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Revenue"
          value={money(report.revenue)}
          hint={
            change === null
              ? "Net of refunds"
              : `${change >= 0 ? "+" : ""}${change}% on the previous ${days} days`
          }
          primary
        />
        <Stat label="Orders" value={String(report.orders)} hint="Paid, not refunded" />
        <Stat label="Average order" value={money(report.averageOrderValue)} />
        <Stat label="Jars sold" value={String(report.units)} />
      </dl>

      <section className="mt-14">
        <h2 className="font-serif text-3xl tracking-[-.03em]">Revenue by day</h2>
        {report.revenue === 0 ? (
          <p className="mt-5 text-sm text-muted-foreground">
            No paid orders in this period yet.
          </p>
        ) : (
          <>
            {/* A plain bar chart in markup: no charting library for four dozen
                numbers, and it stays readable with CSS disabled. */}
            <ol className="mt-6 flex h-48 items-end gap-[2px]" aria-hidden>
              {report.days.map((day) => (
                <li
                  key={day.date}
                  title={`${day.date}: ${money(day.revenue)}`}
                  style={{ height: `${Math.max(2, (day.revenue / peak) * 100)}%` }}
                  className="flex-1 rounded-t-sm bg-primary/70 transition-colors hover:bg-primary"
                />
              ))}
            </ol>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{report.days[0]?.date}</span>
              <span>{report.days[report.days.length - 1]?.date}</span>
            </div>

            {/* The same numbers, reachable by anyone the chart does not work
                for. The chart above is decoration; this is the data. */}
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-primary">
                Show the daily figures
              </summary>
              <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <caption className="sr-only">Revenue and orders for each of the last {days} days</caption>
                  <thead>
                    <tr className="border-b border-border text-left">
                      {["Date", "Orders", "Revenue"].map((h) => (
                        <th
                          key={h}
                          scope="col"
                          className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.days.map((day) => (
                      <tr key={day.date} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-2">{day.date}</td>
                        <td className="px-4 py-2 tabular-nums">{day.orders}</td>
                        <td className="px-4 py-2 tabular-nums">{money(day.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>

      <div className="mt-14 grid gap-10 lg:grid-cols-2 lg:gap-14">
        <section>
          <h2 className="font-serif text-3xl tracking-[-.03em]">Best sellers</h2>
          {report.bestSellers.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">Nothing sold in this period.</p>
          ) : (
            <ul className="mt-6 space-y-4">
              {report.bestSellers.map((seller) => (
                <li key={seller.productId} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-serif text-xl">{seller.name}</span>
                    <span className="text-sm font-semibold tabular-nums">{money(seller.revenue)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.round((seller.units / Math.max(1, report.bestSellers[0].units)) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{seller.units} jars</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="font-serif text-3xl tracking-[-.03em]">Newsletter</h2>
          <div className="mt-6 rounded-lg border border-border bg-card p-5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">
                Subscribers
              </span>
              <Badge>{subscribers.active} active</Badge>
            </div>
            <p className="mt-4 font-serif text-4xl">{subscribers.active}</p>
            {subscribers.total > subscribers.active && (
              <p className="mt-2 text-xs text-muted-foreground">
                {subscribers.total - subscribers.active} have unsubscribed.
              </p>
            )}
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Collected from the footer form. Everyone can opt out with a one-click link, which is
              what keeps the list out of spam folders.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  primary,
}: {
  label: string;
  value: string;
  hint?: string;
  primary?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-5">
      <dt className="text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-3">
        <span className={`block font-serif text-3xl tracking-[-.02em] ${primary ? "text-primary" : ""}`}>
          {value}
        </span>
        {hint && <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
}
