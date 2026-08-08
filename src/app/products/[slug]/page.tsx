import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AddToBag } from "@/components/add-to-bag";
import { ProductSchema } from "@/components/product-schema";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { HERITAGE_NOTE, productBySlug, products } from "@/lib/products";
import { ZONE_RATES } from "@/lib/shipping";
import { availability } from "@/lib/stock";
import { money } from "@/lib/utils";

export function generateStaticParams() {
  return products.map((p) => ({ slug: p.slug }));
}

/**
 * Rebuilt every five minutes.
 *
 * Statically rendered pages are the right default here, but the page now
 * publishes stock availability as structured data, and a page that tells a
 * search engine "in stock" while the shop is sold out is a false machine-
 * readable claim. Five minutes keeps that honest without giving up static
 * rendering for every visitor.
 */
export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = productBySlug(slug);
  if (!product) return { title: "Product not found" };
  return {
    title: product.name,
    description: product.description,
    openGraph: { title: product.name, description: product.description, images: [product.image] },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = productBySlug(slug);
  if (!product) notFound();

  const others = products.filter((p) => p.id !== product.id);
  const { nutrition } = product;

  // Only claim availability for a product the shop actually counts — and only
  // when the database is reachable at all. This page is prerendered, and a
  // build machine has no database, so a hard read here would break the build
  // rather than merely omit a line of structured data.
  const soldOut = await soldOutState(product.id);
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ProductSchema product={product} soldOut={soldOut} siteUrl={siteUrl} />
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="outline-none">

      <div className="mx-auto max-w-[1440px] px-5 pt-8 lg:px-10">
        <nav className="text-xs text-muted-foreground" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-primary">
            Home
          </Link>
          <span className="px-2">/</span>
          <Link href="/#collection" className="hover:text-primary">
            Shop
          </Link>
          <span className="px-2">/</span>
          <span className="text-foreground">{product.name}</span>
        </nav>
      </div>

      <section className="mx-auto grid max-w-[1440px] gap-12 px-5 py-10 lg:grid-cols-2 lg:gap-20 lg:px-10 lg:py-16">
        <div className="relative aspect-[4/5] overflow-hidden rounded-lg" style={{ backgroundColor: `${product.accent}14` }}>
          <div className="absolute inset-0 grain" />
          <div className="absolute left-6 top-6 font-serif text-6xl leading-none text-black/[.08]">{product.arabic}</div>
          <Image
            src={product.image}
            alt={product.name}
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-contain p-10 drop-shadow-[0_20px_30px_rgba(0,0,0,.18)]"
          />
        </div>

        <div className="flex flex-col">
          <div className="flex flex-wrap gap-2">
            {product.tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
          <h1 className="mt-5 font-serif text-6xl leading-[.95] tracking-[-.045em] lg:text-7xl">{product.name}</h1>
          <div className="mt-6 flex items-baseline gap-4">
            <span className="font-serif text-4xl">{money(product.price)}</span>
            <span className="text-sm text-muted-foreground">{product.weightGrams}g jar</span>
          </div>
          <p className="mt-7 text-base leading-8 text-muted-foreground">{product.description}</p>

          <div className="mt-9">
            <AddToBag product={product} />
          </div>

          {/* Built as one string: JSX collapses whitespace around wrapped text nodes. */}
          <p className="mt-5 text-xs leading-5 text-muted-foreground">
            {`Delivery ${money(ZONE_RATES.west.fee)} within Semenanjung Malaysia, ${money(
              ZONE_RATES.east.fee,
            )} to Sabah, Sarawak & Labuan. Free Peninsular delivery over ${money(ZONE_RATES.west.freeFrom)}.`}
          </p>

          <Separator className="my-10" />

          <div className="grid gap-10 sm:grid-cols-2">
            <div>
              <h2 className="eyebrow">Serve it with</h2>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                {product.servingSuggestions.map((s) => (
                  <li key={s} className="border-b border-border pb-2">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="eyebrow">Nutrition</h2>
              <p className="mt-4 text-xs text-muted-foreground">Per serving of {nutrition.servingSize}</p>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {[
                    ["Energy", `${nutrition.energyKcal} kcal (${nutrition.energyKj} kJ)`],
                    ["Carbohydrate", nutrition.carbohydrate],
                    ["Protein", nutrition.protein],
                    ["Fat", nutrition.fat],
                  ].map(([label, value]) => (
                    <tr key={label} className="border-b border-border">
                      <th scope="row" className="py-2 text-left font-normal text-muted-foreground">
                        {label}
                      </th>
                      <td className="py-2 text-right">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <blockquote className="mt-10 border-l border-border pl-5 text-sm italic leading-7 text-muted-foreground">
            {HERITAGE_NOTE}
          </blockquote>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-5 py-16 lg:px-10 lg:py-24">
        <p className="eyebrow">Also in the range</p>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {others.map((p) => (
            <Link
              key={p.id}
              href={`/products/${p.slug}`}
              className="group flex items-center gap-6 rounded-lg border border-border p-5 transition-colors hover:bg-muted/50"
            >
              <div
                className="relative size-28 shrink-0 overflow-hidden rounded-md"
                style={{ backgroundColor: `${p.accent}14` }}
              >
                <Image src={p.image} alt="" fill sizes="112px" className="object-contain p-2" />
              </div>
              <div>
                <h3 className="font-serif text-3xl transition-colors group-hover:text-primary">{p.name}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{p.tagline}</p>
                <p className="mt-3 text-sm font-semibold">{money(p.price)}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      </main>
      <SiteFooter />
    </div>
  );
}

/**
 * Whether a product is sold out, or undefined when that is not knowable.
 *
 * Undefined covers three cases that should all behave the same way: the product
 * is not stock-tracked, the database is unreachable, or this is a build machine
 * with no database at all. In every one of them the page simply does not claim
 * an availability — which is the honest answer, and the one that keeps the
 * structured data from asserting something it cannot stand behind.
 */
async function soldOutState(productId: string): Promise<boolean | undefined> {
  try {
    const level = (await availability()).get(productId);
    if (!level?.tracked) return undefined;
    return level.available === 0;
  } catch {
    return undefined;
  }
}
