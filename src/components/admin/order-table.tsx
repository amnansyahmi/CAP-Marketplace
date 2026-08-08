import Link from "next/link";

import type { Order } from "@/lib/orders";
import { money } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT = {
  paid: "default",
  pending_payment: "outline",
  failed: "destructive",
  cancelled: "outline",
} as const;

export function StatusBadge({ status }: { status: Order["status"] }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status.replace("_", " ")}</Badge>;
}

export function FulfilmentBadge({ fulfilment }: { fulfilment: Order["fulfilment"] }) {
  return (
    <Badge variant={fulfilment === "delivered" ? "secondary" : "outline"}>
      {fulfilment}
    </Badge>
  );
}

const dateFormat = new Intl.DateTimeFormat("en-MY", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

export function OrderTable({ orders }: { orders: Order[] }) {
  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center">
        <p className="font-serif text-2xl">No orders here.</p>
        <p className="mt-2 text-sm text-muted-foreground">Try a different filter.</p>
      </div>
    );
  }

  return (
    // Tables do not reflow, so let this one scroll rather than break the page.
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            {["Order", "Placed", "Customer", "Payment", "Fulfilment", "Total"].map((h) => (
              <th key={h} scope="col" className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
              <td className="px-4 py-3">
                <Link href={`/admin/orders/${order.reference}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                  {order.reference}
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                {formatDate(order.createdAt)}
              </td>
              <td className="px-4 py-3">
                <div className="font-medium">{order.customer.fullName}</div>
                <div className="text-xs text-muted-foreground">{order.address.state}</div>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={order.status} />
              </td>
              <td className="px-4 py-3">
                {order.status === "paid" ? (
                  <FulfilmentBadge fulfilment={order.fulfilment} />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-semibold">{money(order.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
