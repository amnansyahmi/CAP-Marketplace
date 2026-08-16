import Link from "next/link";
import type { Metadata } from "next";

import { ProductForm } from "@/app/admin/(dashboard)/products/product-form";
import { priceMap, priceOverrides } from "@/lib/pricing";
import { productById, products } from "@/lib/products";
import { salesReport } from "@/lib/reporting";
import { availability } from "@/lib/stock";
import { money } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Products" };

/**
 * Price and stock, per product, with what each one has actually sold.
 *
 * One page because it is one decision. Setting a price without seeing how many
 * jars moved at the old one is guessing, and the count was previously two
 * clicks away on the reports page.
 */
export default async function ProductsPage() {
  const [levels, prices, overrides, report] = await Promise.all([
    availability(),
    priceMap(),
    priceOverrides(),
    salesReport(30),
  ]);

  const sold = new Map(report.bestSellers.map((seller) => [seller.productId, seller]));
  const soldOut = products.filter((p) => levels.get(p.id)?.tracked && levels.get(p.id)?.available === 0);

  return (
    <div className="mx-auto max-w-[900px] px-5 py-10 lg:px-8 lg:py-14">
      <p className="eyebrow">Products</p>
      <h1 className="mt-3 font-serif text-5xl tracking-[-.04em]">What you sell, and for how much.</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
        Prices take effect on the next order placed — nothing already sold is re-priced. Stock is held the
        moment an order is placed, not when it is paid, so two customers cannot both buy the last jar while
        one of them is still on the payment page.
      </p>

      <dl className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          { label: "Revenue, 30 days", value: money(report.revenue) },
          { label: "Jars sold, 30 days", value: String(report.units) },
          { label: "Average order", value: money(report.averageOrderValue) },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-card p-5">
            <dt className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">
              {stat.label}
            </dt>
            <dd className="mt-2 font-serif text-3xl tracking-[-.02em]">{stat.value}</dd>
          </div>
        ))}
      </dl>

      {soldOut.length > 0 && (
        <p
          role="status"
          className="mt-8 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {soldOut.length === 1
            ? `${productById(soldOut[0].id)?.name ?? soldOut[0].id} is sold out and cannot be ordered.`
            : `${soldOut.length} products are sold out and cannot be ordered.`}
        </p>
      )}

      <div className="mt-10 space-y-5">
        {products.map((product) => {
          const level = levels.get(product.id);
          return (
            <ProductForm
              key={product.id}
              productId={product.id}
              name={product.name}
              price={prices.get(product.id) ?? product.price}
              cataloguePrice={product.price}
              priceChangedAt={overrides.get(product.id)?.updatedAt}
              tracked={level?.tracked ?? false}
              onHand={level?.onHand ?? 0}
              reserved={level?.reserved ?? 0}
              soldThisMonth={sold.get(product.id)?.units ?? 0}
            />
          );
        })}
      </div>

      <p className="mt-10 text-sm text-muted-foreground">
        Running a promotion instead of changing a price?{" "}
        <Link href="/admin/discounts" className="underline underline-offset-2 hover:text-primary">
          Issue a discount code
        </Link>
        . For sales by day and by product, see{" "}
        <Link href="/admin/reports" className="underline underline-offset-2 hover:text-primary">
          reports
        </Link>
        .
      </p>
    </div>
  );
}
