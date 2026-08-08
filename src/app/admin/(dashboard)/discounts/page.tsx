import type { Metadata } from "next";

import { setDiscountActive } from "@/app/admin/actions";
import { NewDiscountForm } from "@/app/admin/(dashboard)/discounts/new-discount-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { discountStore } from "@/lib/discounts";
import { money } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Discounts" };

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default async function DiscountsPage() {
  const codes = await discountStore.list();
  const now = new Date();

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-10 lg:px-8 lg:py-14">
      <p className="eyebrow">Discounts</p>
      <h1 className="mt-3 font-serif text-5xl tracking-[-.04em]">Codes you have issued.</h1>

      <div className="mt-12 grid gap-10 lg:grid-cols-[1.5fr_1fr] lg:gap-14">
        <div>
          <h2 className="font-serif text-3xl tracking-[-.03em]">All codes</h2>
          <div className="mt-6">
            {codes.length === 0 ? (
              <div className="rounded-lg border border-border bg-card p-12 text-center">
                <p className="font-serif text-2xl">No codes yet.</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Create one and share it to run a promotion.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full min-w-[46rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {["Code", "Discount", "Min spend", "Used", "Expires", ""].map((h) => (
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
                    {codes.map((code) => {
                      const expired = code.expiresAt != null && new Date(code.expiresAt) <= now;
                      const usedUp =
                        code.maxRedemptions !== null && code.redeemed >= code.maxRedemptions;
                      return (
                        <tr key={code.id} className="border-b border-border last:border-b-0">
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs text-primary">{code.code}</span>
                            {!code.active && (
                              <Badge className="ml-2 text-muted-foreground">off</Badge>
                            )}
                            {code.active && (expired || usedUp) && (
                              <Badge className="ml-2 text-muted-foreground">
                                {expired ? "expired" : "used up"}
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 tabular-nums">
                            {code.kind === "percent"
                              ? `${(code.value * 100).toFixed(code.value * 100 % 1 === 0 ? 0 : 1)}%`
                              : money(code.value)}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-muted-foreground">
                            {code.minSubtotal > 0 ? money(code.minSubtotal) : "—"}
                          </td>
                          <td className="px-4 py-3 tabular-nums">
                            {code.redeemed}
                            {code.maxRedemptions !== null && ` / ${code.maxRedemptions}`}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{when(code.expiresAt)}</td>
                          <td className="px-4 py-3 text-right">
                            <form action={setDiscountActive}>
                              <input type="hidden" name="discountId" value={code.id} />
                              <input type="hidden" name="active" value={String(!code.active)} />
                              <Button type="submit" variant="ghost" size="sm">
                                {code.active ? "Turn off" : "Turn on"}
                              </Button>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div>
          <h2 className="font-serif text-3xl tracking-[-.03em]">New code</h2>
          <div className="mt-6 rounded-lg border border-border bg-card p-6">
            <NewDiscountForm />
          </div>
        </div>
      </div>
    </div>
  );
}
