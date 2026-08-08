import Link from "next/link";
import type { Metadata } from "next";

import { OrderTable } from "@/components/admin/order-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FULFILMENT_STEPS,
  orderStore,
  type Fulfilment,
  type OrderStatus,
} from "@/lib/orders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Orders" };

const STATUSES: OrderStatus[] = ["pending_payment", "paid", "failed", "cancelled"];
const PAGE_SIZE = 25;

/** Only accept values we know; anything else is dropped rather than queried. */
const asStatus = (v?: string) => (STATUSES.includes(v as OrderStatus) ? (v as OrderStatus) : undefined);
const asFulfilment = (v?: string) =>
  FULFILMENT_STEPS.includes(v as Fulfilment) ? (v as Fulfilment) : undefined;

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; fulfilment?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const status = asStatus(params.status);
  const fulfilment = asFulfilment(params.fulfilment);
  const search = params.q?.trim() || undefined;
  const page = Math.max(1, Number(params.page) || 1);

  const { orders, total } = await orderStore.list({
    status,
    fulfilment,
    search,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const query = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { status, fulfilment, q: search, page: String(page), ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v && v !== "1") next.set(k, v);
    const s = next.toString();
    return s ? `/admin/orders?${s}` : "/admin/orders";
  };

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-10 lg:px-8 lg:py-14">
      <p className="eyebrow">Orders</p>
      <h1 className="mt-3 font-serif text-5xl tracking-[-.04em]">
        {total} order{total === 1 ? "" : "s"}.
      </h1>

      {/* A GET form keeps filters in the URL, so a view can be bookmarked and shared. */}
      <form method="get" className="mt-8 flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <Label htmlFor="q" className="mb-2">
            Search
          </Label>
          <Input id="q" name="q" defaultValue={search ?? ""} placeholder="Reference, name or email" />
        </div>
        <div>
          <Label htmlFor="status" className="mb-2">
            Payment
          </Label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className="h-11 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="fulfilment" className="mb-2">
            Fulfilment
          </Label>
          <select
            id="fulfilment"
            name="fulfilment"
            defaultValue={fulfilment ?? ""}
            className="h-11 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <option value="">Any</option>
            {FULFILMENT_STEPS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="warm">
          Filter
        </Button>
        {(status || fulfilment || search) && (
          <Button asChild variant="ghost">
            <Link href="/admin/orders">Clear</Link>
          </Button>
        )}
      </form>

      <div className="mt-8">
        <OrderTable orders={orders} />
      </div>

      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-between gap-4" aria-label="Pagination">
          <Button asChild variant="outline" size="sm" disabled={page <= 1}>
            <Link href={query({ page: String(page - 1) })} aria-disabled={page <= 1}>
              Previous
            </Link>
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button asChild variant="outline" size="sm" disabled={page >= pages}>
            <Link href={query({ page: String(page + 1) })} aria-disabled={page >= pages}>
              Next
            </Link>
          </Button>
        </nav>
      )}
    </div>
  );
}
