import type { Metadata } from "next";

import { StockForm } from "@/app/admin/(dashboard)/stock/stock-form";
import { productById } from "@/lib/products";
import { stockLevels } from "@/lib/stock";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stock" };

export default async function StockPage() {
  const levels = await stockLevels();
  const tracked = levels.filter((l) => l.tracked);
  const soldOut = tracked.filter((l) => l.available === 0);

  return (
    <div className="mx-auto max-w-[900px] px-5 py-10 lg:px-8 lg:py-14">
      <p className="eyebrow">Stock</p>
      <h1 className="mt-3 font-serif text-5xl tracking-[-.04em]">What is on the shelf.</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
        Stock is held the moment an order is placed, not when it is paid — so two customers cannot both
        buy the last jar while one of them is still on the payment page.
      </p>

      {soldOut.length > 0 && (
        <p
          role="status"
          className="mt-8 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {soldOut.length === 1
            ? `${productById(soldOut[0].productId)?.name ?? soldOut[0].productId} is sold out and cannot be ordered.`
            : `${soldOut.length} products are sold out and cannot be ordered.`}
        </p>
      )}

      <div className="mt-10 space-y-5">
        {levels.map((level) => (
          <StockForm
            key={level.productId}
            productId={level.productId}
            name={productById(level.productId)?.name ?? level.productId}
            tracked={level.tracked}
            onHand={level.onHand}
            reserved={level.reserved}
          />
        ))}
      </div>
    </div>
  );
}
