import Link from "next/link";

import { OrderTable } from "@/components/admin/order-table";
import { Button } from "@/components/ui/button";
import { agentConfig } from "@/lib/agent";
import { chipConfig } from "@/lib/chip";
import { usingExternalDatabase } from "@/lib/db/client";
import { orderStore } from "@/lib/orders";
import { money } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const [stats, recent] = await Promise.all([
    orderStore.stats(),
    orderStore.list({ limit: 8 }),
  ]);

  const { isLive } = chipConfig();
  const agent = agentConfig();
  const warnings = [
    !isLive && "CHIP credentials are not set, so payments are simulated and no money is collected.",
    !usingExternalDatabase() &&
      "DATABASE_URL is not set. Orders are stored locally via PGlite, which is development only.",
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-10 lg:px-8 lg:py-14">
      <p className="eyebrow">Overview</p>
      <h1 className="mt-3 font-serif text-5xl tracking-[-.04em]">Your shop today.</h1>

      {warnings.length > 0 && (
        <div className="mt-8 space-y-2">
          {warnings.map((w) => (
            <p key={w} className="rounded-md border border-border bg-muted/60 p-3 text-xs leading-6 text-muted-foreground">
              {w}
            </p>
          ))}
        </div>
      )}

      <dl className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Stat label="Revenue" value={money(stats.revenue)} hint="Settled orders only" primary />
        <Stat label="Paid orders" value={String(stats.paidCount)} />
        <Stat label="Awaiting fulfilment" value={String(stats.awaitingFulfilment)} hint="Paid, not yet shipped" />
        <Stat label="Awaiting payment" value={String(stats.pendingCount)} />
        {agent.enabled && (
          <Stat
            label={`${agent.name} fees`}
            value={money(stats.agentFeesOwed)}
            hint={`${money(agent.feePerSale)} per ${agent.basis === "unit" ? "jar" : "order"}, accrued on paid orders`}
          />
        )}
      </dl>

      <div className="mt-14 flex items-end justify-between gap-6">
        <h2 className="font-serif text-3xl tracking-[-.03em]">Recent orders</h2>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/orders">View all {recent.total}</Link>
        </Button>
      </div>
      <div className="mt-6">
        <OrderTable orders={recent.orders} />
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
    // A definition list may only hold dt/dd pairs (optionally grouped in a
    // div), so the hint sits inside the dd rather than as a sibling — which is
    // also where it belongs, since it qualifies the value.
    <div className="rounded-lg border border-border bg-card p-5">
      <dt className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">{label}</dt>
      <dd className="mt-3">
        <span className={`block font-serif text-4xl tracking-[-.03em] ${primary ? "text-primary" : ""}`}>
          {value}
        </span>
        {hint && <span className="mt-2 block text-xs text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
}
