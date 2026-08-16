import Marketplace from "@/components/marketplace";
import { SeedPrices } from "@/lib/live-catalogue";
import { priceMap } from "@/lib/pricing";

/**
 * Rebuilt every five minutes, like the product pages.
 *
 * The page stays static — five thousand people reading it is a CDN's problem,
 * not the database's — but it now carries prices the shop owner can change, and
 * a front page quoting last week's price is worse than a five-minute delay.
 */
export const revalidate = 300;

export default async function Page() {
  const prices = Object.fromEntries(await priceMap());
  return (
    <SeedPrices prices={prices}>
      <Marketplace />
    </SeedPrices>
  );
}
