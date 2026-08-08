import type { Product } from "@/lib/products";

/**
 * Product structured data, so search results can show price and availability.
 *
 * Two things this is careful about, because getting either wrong is worse than
 * having no structured data at all:
 *
 * - **Availability is only claimed when it is known.** A page that statically
 *   says "InStock" while the shop is sold out is a false claim in a
 *   machine-readable format, and search engines treat a mismatch between
 *   structured data and the page as a reason to distrust the whole site. The
 *   product page revalidates periodically so this stays close to true, and
 *   untracked products simply do not assert a stock level.
 * - **Only facts the shop actually has.** No invented ratings, no review counts.
 *   Fabricated review markup is the single most common reason a shop gets its
 *   rich results removed, and there are no reviews here yet.
 */
export function ProductSchema({
  product,
  soldOut,
  siteUrl,
}: {
  product: Product;
  /** Undefined when the product is not stock-tracked, so nothing is claimed. */
  soldOut?: boolean;
  siteUrl: string;
}) {
  const url = `${siteUrl}/products/${product.slug}`;

  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: `${siteUrl}${product.image}`,
    sku: product.id,
    brand: { "@type": "Brand", name: "Chef Ammar" },
    weight: { "@type": "QuantitativeValue", value: product.weightGrams, unitCode: "GRM" },
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "MYR",
      price: product.price.toFixed(2),
      ...(soldOut === undefined
        ? {}
        : {
            availability: soldOut
              ? "https://schema.org/OutOfStock"
              : "https://schema.org/InStock",
          }),
      seller: { "@type": "Organization", name: "Chef Ammar" },
    },
  };

  return (
    <script
      type="application/ld+json"
      // Structured data has to be in the HTML for a crawler to see it, and this
      // object is built here from the catalogue — none of it is user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
