import type { MetadataRoute } from "next";

/**
 * What crawlers may look at.
 *
 * The admin and affiliate portal are already behind authentication, and order
 * pages need a signed link — this is not what protects them. It stops crawlers
 * wasting requests on doors that will not open, and keeps private URLs out of
 * search results if one is ever shared by accident.
 */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/affiliate", "/orders/", "/checkout", "/api/", "/unsubscribe"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
