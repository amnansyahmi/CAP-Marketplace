"use client";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { HERITAGE_NOTE, products, startingPrice, type Product } from "@/lib/products";
import { useCart } from "@/lib/cart-context";
import { useAddToBag } from "@/lib/use-add-to-bag";
import { ZONE_RATES } from "@/lib/shipping";
import { money } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const promises = [
  { title: "Dinner in less time", text: "A practical shortcut without flattening the flavour." },
  { title: "Kitchen-tested", text: "Balanced recipes, created for consistent results." },
  { title: "Delivered across Malaysia", text: "Packed carefully and sent directly to your door." },
];

const faqs = [
  {
    q: "How long does delivery take?",
    a: "Orders across Peninsular Malaysia arrive within 2-4 working days. Sabah, Sarawak and Labuan may take a little longer.",
  },
  {
    q: "How much is delivery?",
    a: `Delivery is ${money(ZONE_RATES.west.fee)} within Semenanjung Malaysia and ${money(
      ZONE_RATES.east.fee,
    )} to Sabah, Sarawak and Labuan. Spend ${money(ZONE_RATES.west.freeFrom)} or more and Peninsular delivery is on us.`,
  },
  {
    q: "How should I store the paste?",
    a: "Refrigerate after opening and use within the date on the label. Unopened jars keep well in a cool, dry pantry.",
  },
  {
    q: "Can I adjust the spice level?",
    a: "Yes — each paste is a flavour base. Use less for a milder dish or extra for more heat and depth.",
  },
  {
    q: "How many servings does one jar make?",
    a: "Each 350g jar seasons roughly 1kg of rice or protein, enough for 4-5 generous servings.",
  },
];

export default function Marketplace() {
  const [quickView, setQuickView] = useState<Product | null>(null);
  const addToBag = useAddToBag();

  return (
    <div className="min-h-screen overflow-hidden bg-background text-foreground">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <Hero />
        <Promises />
        <Collection onAdd={addToBag} onQuickView={setQuickView} />
        <Story />
        <Guide />
        <Faq />
      </main>
      <SiteFooter />
      <QuickViewDialog
        product={quickView}
        onOpenChange={(open) => !open && setQuickView(null)}
        onAdd={addToBag}
      />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative mx-auto grid max-w-[1440px] lg:min-h-[720px] lg:grid-cols-[.88fr_1.12fr]">
      <div className="flex flex-col justify-center px-6 py-18 lg:px-14 lg:py-24 xl:px-24">
        <p className="eyebrow mb-6">Made for generous tables</p>
        <h1 className="max-w-2xl font-serif text-[clamp(3.6rem,7.4vw,7.5rem)] leading-[.88] tracking-[-.055em]">
          Arabian rice, made easier.
        </h1>
        <p className="mt-8 max-w-lg text-base leading-7 text-muted-foreground lg:text-lg">
          Chef-crafted cooking pastes with deep aroma, honest ingredients and enough flavour for the whole family.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-6">
          <Button
            variant="warm"
            size="lg"
            onClick={() => document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" })}
          >
            Shop the collection
          </Button>
          <span className="text-sm text-muted-foreground">From {money(startingPrice())} per 350g jar</span>
        </div>
      </div>
      <div className="relative min-h-[520px] overflow-hidden bg-[#ded2bd] lg:min-h-full">
        <div className="absolute inset-0 grain" />
        <div className="absolute left-[6%] top-[8%] font-serif text-[10rem] leading-none text-black/[.05] lg:text-[17rem]">
          أ
        </div>
        {/* The three real jars, staggered — the centre one leads. */}
        <div className="absolute inset-0 flex items-end justify-center gap-[3%] px-[6%] pb-[7%]">
          {[products[0], products[1], products[2]].map((p, i) => (
            <div
              key={p.id}
              className={`relative w-[30%] ${i === 1 ? "h-[88%]" : "h-[72%]"}`}
              style={{ zIndex: i === 1 ? 2 : 1 }}
            >
              <Image
                src={p.image}
                alt={`${p.name} jar`}
                fill
                priority={i === 1}
                sizes="(max-width: 1024px) 30vw, 22vw"
                className="object-contain object-bottom drop-shadow-[0_18px_28px_rgba(0,0,0,.22)]"
              />
            </div>
          ))}
        </div>
        <div className="absolute left-7 top-7 border-l border-black/30 pl-4 text-xs leading-5">
          <strong className="block uppercase tracking-[.18em]">Signature collection</strong>
          <span className="text-black/70">Three pastes, one range</span>
        </div>
      </div>
    </section>
  );
}

function Promises() {
  return (
    <section className="border-y border-border bg-[#272821] text-[#f5f0e7]">
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 divide-y divide-white/12 md:grid-cols-3 md:divide-x md:divide-y-0">
        {promises.map((p, i) => (
          <div key={p.title} className="px-6 py-9 lg:px-10">
            <span className="text-[10px] tracking-[.22em] text-white/60">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="mt-5 text-sm font-medium">{p.title}</h3>
            <p className="mt-2 max-w-xs text-xs leading-5 text-white/55">{p.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Collection({ onAdd, onQuickView }: { onAdd: (p: Product) => void; onQuickView: (p: Product) => void }) {
  return (
    <section id="collection" className="mx-auto max-w-[1440px] px-5 py-20 lg:px-10 lg:py-28">
      <div className="mb-12 flex items-end justify-between gap-8">
        <div>
          <p className="eyebrow">The full range</p>
          <h2 className="mt-3 font-serif text-5xl tracking-[-.04em] lg:text-7xl">Choose your favourite.</h2>
        </div>
        <p className="hidden max-w-sm text-sm leading-6 text-muted-foreground md:block">
          Three blends for different moods, all designed around the same promise: proper flavour without the
          complicated prep.
        </p>
      </div>
      <div className="grid gap-x-6 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} onAdd={() => onAdd(p)} onQuickView={() => onQuickView(p)} />
        ))}
      </div>
    </section>
  );
}

function ProductCard({ product, onAdd, onQuickView }: { product: Product; onAdd: () => void; onQuickView: () => void }) {
  const { lines } = useCart();
  const quantity = lines.find((l) => l.product.id === product.id)?.quantity ?? 0;

  return (
    <Card className="group gap-0 overflow-hidden">
      <div className="relative aspect-[4/5] overflow-hidden" style={{ backgroundColor: `${product.accent}14` }}>
        <Link href={`/products/${product.slug}`} className="absolute inset-0 z-[1]">
          <Image
            src={product.image}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-contain p-8 transition-transform duration-700 group-hover:scale-[1.03]"
          />
          <span className="sr-only">View {product.name}</span>
        </Link>
        <div className="pointer-events-none absolute left-4 top-4 text-2xl text-black/25">{product.arabic}</div>
        {quantity > 0 && (
          <span
            className="pointer-events-none absolute right-4 top-4 z-[2] grid size-8 place-items-center rounded-md bg-foreground text-xs text-background"
            aria-label={`${quantity} in bag`}
          >
            {quantity}
          </span>
        )}
        <button
          onClick={onQuickView}
          className="absolute inset-x-4 bottom-4 z-[2] rounded-md border border-border bg-background/92 py-2.5 text-[10px] font-semibold uppercase tracking-[.16em] opacity-0 backdrop-blur transition-opacity duration-300 group-hover:opacity-100 focus-visible:opacity-100"
        >
          Quick view<span className="sr-only"> {product.name}</span>
        </button>
      </div>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-serif text-2xl tracking-[-.02em]">
              <Link href={`/products/${product.slug}`} className="transition-colors hover:text-primary">
                {product.name}
              </Link>
            </h3>
            <p className="mt-2 min-h-10 text-sm leading-5 text-muted-foreground">{product.tagline}</p>
          </div>
          <div className="shrink-0 text-right">
            <span className="text-sm font-semibold">{money(product.price)}</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">{product.weightGrams}g</span>
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          {product.tags.slice(0, 1).map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      </CardContent>
      <CardFooter className="gap-3 pb-6 pt-5">
        <Button variant="outline" className="flex-1" onClick={onAdd}>
          Add to bag
        </Button>
      </CardFooter>
    </Card>
  );
}

function QuickViewDialog({
  product,
  onOpenChange,
  onAdd,
}: {
  product: Product | null;
  onOpenChange: (open: boolean) => void;
  onAdd: (p: Product) => void;
}) {
  return (
    <Dialog open={!!product} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        {product && (
          <div className="grid sm:grid-cols-2">
            <div className="relative aspect-square sm:aspect-auto" style={{ backgroundColor: `${product.accent}14` }}>
              <Image
                src={product.image}
                alt={product.name}
                fill
                sizes="(max-width: 640px) 100vw, 320px"
                className="object-contain p-6"
              />
              <div className="absolute left-5 top-5 text-3xl text-black/25">{product.arabic}</div>
            </div>
            <div className="flex flex-col p-6">
              <DialogHeader>
                <div className="flex flex-wrap gap-2">
                  {product.tags.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
                <DialogTitle className="mt-3">{product.name}</DialogTitle>
                <DialogDescription className="text-base leading-7">{product.description}</DialogDescription>
              </DialogHeader>
              <div className="mt-auto flex items-baseline justify-between pt-6">
                <span className="font-serif text-3xl">{money(product.price)}</span>
                <span className="text-xs text-muted-foreground">{product.weightGrams}g jar</span>
              </div>
              <DialogFooter className="mt-4 flex-col gap-2 sm:flex-col">
                <Button variant="warm" size="lg" className="w-full" onClick={() => onAdd(product)}>
                  Add to bag
                </Button>
                <Button asChild variant="ghost" className="w-full">
                  <Link href={`/products/${product.slug}`}>View full details</Link>
                </Button>
              </DialogFooter>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Story() {
  const hero = products[0];
  return (
    <section id="story" className="bg-[#e7ddcd] px-5 py-20 lg:px-10 lg:py-28">
      <div className="mx-auto grid max-w-[1360px] gap-14 lg:grid-cols-2 lg:items-center">
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-[#d8c8ac]">
          <div className="absolute inset-0 grain" />
          <div className="absolute right-[6%] top-1/2 -translate-y-1/2 font-serif text-[9rem] leading-none text-black/[.06] lg:text-[13rem]">
            {hero.arabic}
          </div>
          <Image
            src={hero.image}
            alt={`${hero.name} jar`}
            fill
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-contain p-10 drop-shadow-[0_20px_30px_rgba(0,0,0,.2)]"
          />
        </div>
        <div className="max-w-xl lg:pl-12">
          <p className="eyebrow">From Chef Ammar&rsquo;s kitchen</p>
          <h2 className="mt-4 font-serif text-5xl leading-[.98] tracking-[-.045em] lg:text-7xl">
            Good food should bring people closer.
          </h2>
          <p className="mt-7 text-base leading-8 text-muted-foreground">
            This collection is built around the dishes people gather for. The paste handles the layering of aromatics
            and spice, so you can focus on the table, the people and the moment.
          </p>
          <blockquote className="mt-8 border-l border-black/20 pl-5 text-sm italic leading-7 text-black/65">
            {HERITAGE_NOTE}
          </blockquote>
        </div>
      </div>
    </section>
  );
}

function Guide() {
  const steps: [string, string, string][] = [
    ["01", "Sauté", "Cook the paste until fragrant."],
    ["02", "Build", "Add protein, rice and water."],
    ["03", "Gather", "Fluff, serve and bring everyone in."],
  ];
  return (
    <section id="guide" className="mx-auto max-w-[1440px] px-5 py-20 lg:px-10 lg:py-28">
      <p className="eyebrow">Simple by design</p>
      <div className="mt-5 grid gap-0 border-y border-border lg:grid-cols-3">
        {steps.map(([n, t, d]) => (
          <div key={n} className="border-b border-border py-9 lg:border-b-0 lg:border-r lg:px-10 first:pl-0 last:border-r-0">
            <span className="text-xs text-muted-foreground">{n}</span>
            <h3 className="mt-8 font-serif text-4xl">{t}</h3>
            <p className="mt-3 text-sm text-muted-foreground">{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-[900px] px-5 py-20 lg:px-10 lg:py-28">
      <div className="mb-10 text-center">
        <p className="eyebrow">Good to know</p>
        <h2 className="mt-3 font-serif text-5xl tracking-[-.04em] lg:text-6xl">Frequently asked.</h2>
      </div>
      <Accordion type="single" collapsible>
        {faqs.map((f, i) => (
          <AccordionItem key={f.q} value={`item-${i}`}>
            <AccordionTrigger>{f.q}</AccordionTrigger>
            <AccordionContent>{f.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
