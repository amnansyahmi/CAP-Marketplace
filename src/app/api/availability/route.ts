import { NextResponse } from "next/server";

import { stockLevels } from "@/lib/stock";

/**
 * What is currently buyable.
 *
 * A separate endpoint rather than a prop, so the storefront and product pages
 * keep their static rendering and still show live availability. Making those
 * pages dynamic would mean every visitor paying for a database round trip to
 * learn something that is usually "yes, in stock".
 *
 * Deliberately exposes nothing but counts: no order data, no customer data.
 * `reserved` is folded into `available` rather than reported, because how many
 * people are mid-checkout is the shop's business.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const levels = await stockLevels();

  return NextResponse.json(
    {
      products: levels.map((level) => ({
        productId: level.productId,
        // Untracked products are always buyable, and say so rather than
        // reporting a meaningless zero.
        tracked: level.tracked,
        available: level.tracked ? level.available : null,
        soldOut: level.tracked && level.available === 0,
      })),
    },
    // Short-lived cache: stock changes, but not so fast that every card needs
    // its own round trip.
    { headers: { "cache-control": "public, max-age=15, stale-while-revalidate=60" } },
  );
}
