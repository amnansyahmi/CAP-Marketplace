import type { MetadataRoute } from "next";

import { products } from "@/lib/products";

/**
 * Everything worth indexing.
 *
 * Deliberately excludes the admin, the affiliate portal, order pages and the
 * lookup form. Those are either private or per-customer, and listing them would
 * invite a crawler to knock on doors it cannot open.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const now = new Date();

  return [
    { url: base, lastModified: now, changeFrequency: "weekly", priority: 1 },
    ...products.map((product) => ({
      url: `${base}/products/${product.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.9,
    })),
    ...["shipping", "returns", "terms", "privacy", "contact"].map((path) => ({
      url: `${base}/${path}`,
      lastModified: now,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];
}
