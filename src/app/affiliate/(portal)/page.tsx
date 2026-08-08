import Link from "next/link";
import type { Metadata } from "next";

import { ReferralLink } from "@/app/affiliate/(portal)/referral-link";
import { earningsFor, listReferredSales } from "@/lib/affiliate/sales";
import { requireAffiliate } from "@/lib/affiliate/session";
import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

const PAGE_SIZE = 25;

const percent = (rate: number) => `${(rate * 100).toFixed((rate * 100) % 1 === 0 ? 0 : 1)}%`;

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

export default async function AffiliateDashboard({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  // The id comes from the session, never from the URL — that is what stops one
  // affiliate reading another's sales by editing a query string.
  const affiliate = await requireAffiliate();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const [earnings, { sales, total }] = await Promise.all([
    earningsFor(affiliate.id),
    listReferredSales(affiliate.id, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://your-domain.my";

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-10 lg:px-8 lg:py-14">
      <p className="eyebrow">{affiliate.code}</p>
      <h1 className="mt-3 font-serif text-5xl tracking-[-.04em]">Hello, {affiliate.name}.</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
        You earn {percent(affiliate.commissionRate)} of the goods subtotal on every order placed
        through your link. Delivery is not commissionable — it goes straight to the courier.
      </p>

      <section className="mt-10 rounded-lg border border-border bg-card p-5 lg:p-6">
        <h2 className="text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">
          Your referral link
        </h2>
        <div className="mt-3">
          <ReferralLink code={affiliate.code} fallback={`${base}/?ref=${affiliate.code}`} />
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Anyone who opens this link is credited to you for 30 days, even if they buy later.
        </p>
      </section>

      <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Awaiting payout" value={money(earnings.owed)} hint="Earned, not yet paid" primary />
        <Stat label="Paid to you" value={money(earnings.paid)} />
        <Stat label="Orders" value={String(earnings.paidOrders)} hint="Paid for" />
        <Stat label="Sales referred" value={money(earnings.salesSubtotal)} hint="Goods, before delivery" />
      </dl>

      <section className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-serif text-3xl tracking-[-.03em]">Orders from your link</h2>
          {earnings.pendingOrders > 0 && (
            <p className="text-xs text-muted-foreground">
              {earnings.pendingOrders} still awaiting payment — nothing is earned until they settle.
            </p>
          )}
        </div>

        <div className="mt-6">
          {sales.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-12 text-center">
              <p className="font-serif text-2xl">No orders yet.</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                Share your link and any order that comes through it will show up here, along with what
                you earned on it.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[48rem] text-sm">
                <caption className="sr-only">
                  Orders referred by {affiliate.code}, most recent first
                </caption>
                <thead>
                  <tr className="border-b border-border text-left">
                    {["Order", "Date", "Buyer", "Jars", "Sale", "Rate", "You earn", "Status"].map((h) => (
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
                  {sales.map((sale) => (
                    <tr key={sale.reference} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                      <td className="px-4 py-3 font-mono text-xs">{sale.reference}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {when(sale.placedAt)}
                      </td>
                      <td className="px-4 py-3">
                        {sale.buyerFirstName}
                        <span className="block text-xs text-muted-foreground">{sale.state}</span>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{sale.units}</td>
                      <td className="px-4 py-3 tabular-nums">{money(sale.subtotal)}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {percent(sale.commissionRate)}
                      </td>
                      <td className="px-4 py-3 font-semibold tabular-nums">
                        {sale.status === "paid" && !sale.refunded ? money(sale.commission) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <CommissionBadge
                          status={sale.status}
                          commission={sale.commissionStatus}
                          refunded={sale.refunded}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {pages > 1 && (
          <nav aria-label="Pages" className="mt-6 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            <span className="flex gap-4">
              {page > 1 && (
                <Link href={`/affiliate?page=${page - 1}`} className="hover:text-primary">
                  Previous
                </Link>
              )}
              {page < pages && (
                <Link href={`/affiliate?page=${page + 1}`} className="hover:text-primary">
                  Next
                </Link>
              )}
            </span>
          </nav>
        )}
      </section>

      <p className="mt-12 max-w-2xl text-xs leading-5 text-muted-foreground">
        Buyers are shown by first name and state only. Their contact details and delivery address
        stay with the shop.
      </p>
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
      {/* The hint belongs inside the <dd>: a <dl> may only contain <dt>/<dd>
          pairs (optionally wrapped in a <div>), so a sibling <p> breaks the
          list's structure for anything reading it as one. */}
      <dd className="mt-3">
        <span className={`block font-serif text-3xl tracking-[-.02em] ${primary ? "text-primary" : ""}`}>
          {value}
        </span>
        {hint && <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
}

/**
 * What the affiliate should understand about this order's money.
 *
 * Payment status comes first: commission on an unpaid order has not been
 * earned, whatever the commission column says, and showing "pending payout"
 * next to an order that failed would promise money nobody owes.
 */
function CommissionBadge({
  status,
  commission,
  refunded,
}: {
  status: string;
  commission: string;
  refunded: boolean;
}) {
  // A refund undoes the sale, so it is shown ahead of anything else — the
  // affiliate needs to know why the commission disappeared.
  if (refunded) return <Badge className="text-muted-foreground">Refunded</Badge>;
  if (status === "failed" || status === "cancelled") {
    return <Badge className="text-muted-foreground">Not completed</Badge>;
  }
  if (status !== "paid") return <Badge className="text-muted-foreground">Awaiting payment</Badge>;
  if (commission === "paid") return <Badge>Paid out</Badge>;
  return <Badge className="border-primary/40 text-primary">Awaiting payout</Badge>;
}
