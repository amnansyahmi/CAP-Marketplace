"use client";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { BRAND_TAGLINE, HERITAGE_NOTE, products, startingPrice, type Product } from "@/lib/products";
import { useCart } from "@/lib/cart-context";
import { useAddToBag } from "@/lib/use-add-to-bag";
import { useAvailability, type Availability } from "@/lib/use-availability";
import { ZONE_RATES } from "@/lib/shipping";
import { cn, money } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Marquee } from "@/components/marquee";
import { Jar } from "@/components/jar3d/jar";
import { Showpiece } from "@/components/jar3d/showpiece";
import { HeroJars } from "@/components/motion/hero-jars";
import { Reveal } from "@/components/motion/reveal";
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
    // `overflow-x-clip`, not `overflow-hidden`. Both stop the decorative pieces
    // that reach past the edge from making the page scroll sideways, but
    // `hidden` also turns this into a scroll container, and a scroll container
    // is what `position: sticky` sticks to. With `hidden` here the pinned jar
    // in the showpiece scrolled straight past instead of holding still. `clip`
    // does the same job without becoming a container.
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <Hero />
        <Marquee
          items={[BRAND_TAGLINE, "Kabsah", "Mandy", "Briyani", "350g setiap balang", "Dihantar seluruh Malaysia"]}
        />
        <Promises />
        <Collection onAdd={addToBag} onQuickView={setQuickView} />
        <OpenTheJar />
        <Statement />
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
        <Reveal>
          <p className="eyebrow mb-6">Made for generous tables</p>
        </Reveal>
        <Reveal delay={90} distance={32}>
          <h1 className="max-w-2xl font-serif text-[clamp(3.6rem,7.4vw,7.5rem)] leading-[.88] tracking-[-.055em]">
            Arabian rice, made easier.
          </h1>
        </Reveal>
        <Reveal delay={200}>
          <p className="mt-8 max-w-lg text-base leading-7 text-muted-foreground lg:text-lg">
            Chef-crafted cooking pastes with deep aroma, honest ingredients and enough flavour for the whole family.
          </p>
        </Reveal>
        <Reveal delay={300} className="mt-10 flex flex-wrap items-center gap-6">
          <Button
            variant="warm"
            size="lg"
            onClick={() => document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" })}
          >
            Shop the collection
          </Button>
          <span className="text-sm text-muted-foreground">From {money(startingPrice())} per 350g jar</span>
        </Reveal>
      </div>
      <div className="relative min-h-[520px] overflow-hidden bg-[#ded2bd] spice-field lg:min-h-full">
        <div className="absolute inset-0 grain" />
        <div className="absolute left-[6%] top-[8%] font-serif text-[10rem] leading-none text-black/[.05] lg:text-[17rem]">
          أ
        </div>
        <HeroJars products={[products[0], products[1], products[2]]} />
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
          <Reveal key={p.title} delay={i * 110} className="px-6 py-9 lg:px-10">
            <span className="text-[10px] tracking-[.22em] text-white/60">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="mt-5 text-sm font-medium">{p.title}</h3>
            <p className="mt-2 max-w-xs text-xs leading-5 text-white/55">{p.text}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Collection({ onAdd, onQuickView }: { onAdd: (p: Product) => void; onQuickView: (p: Product) => void }) {
  const stock = useAvailability();
  return (
    <section id="collection" className="mx-auto max-w-[1440px] px-5 py-20 lg:px-10 lg:py-28">
      <Reveal className="mb-12 flex items-end justify-between gap-8">
        <div>
          <p className="eyebrow">The full range</p>
          <h2 className="mt-3 font-serif text-5xl tracking-[-.04em] lg:text-7xl">Choose your favourite.</h2>
        </div>
        <p className="hidden max-w-sm text-sm leading-6 text-muted-foreground md:block">
          Three blends for different moods, all designed around the same promise: proper flavour without the
          complicated prep.
        </p>
      </Reveal>
      <div className="grid gap-x-6 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p, i) => (
          // Staggered so the three cards arrive in sequence rather than as one block.
          <Reveal key={p.id} delay={i * 120}>
            <ProductCard
              product={p}
              stock={stock.get(p.id)}
              onAdd={() => onAdd(p)}
              onQuickView={() => onQuickView(p)}
            />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function ProductCard({
  product,
  stock,
  onAdd,
  onQuickView,
}: {
  product: Product;
  stock?: Availability;
  onAdd: () => void;
  onQuickView: () => void;
}) {
  const { lines } = useCart();
  const quantity = lines.find((l) => l.product.id === product.id)?.quantity ?? 0;
  const soldOut = stock?.soldOut ?? false;
  // Only worth mentioning when it is genuinely nearly gone; "8 left" on a
  // shelf of 200 is noise dressed up as urgency.
  const lastFew = !soldOut && stock?.available != null && stock.available <= 5 ? stock.available : null;

  return (
    <Card className="group gap-0 overflow-hidden transition-[transform,box-shadow] duration-500 hover:-translate-y-1.5 hover:shadow-[0_26px_50px_-26px_rgba(60,32,12,.5)] motion-reduce:hover:translate-y-0">
      <div className="relative aspect-[4/5] overflow-hidden" style={{ backgroundColor: `${product.accent}14` }}>
        {/* A wash of the product's own colour, lit on hover, so each card warms
            up in its own hue instead of every card behaving identically. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{ background: `radial-gradient(circle at 50% 62%, ${product.accent}38, transparent 68%)` }}
        />
        <Link href={`/products/${product.slug}`} className="absolute inset-0 z-[1]">
          <Image
            src={product.image}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-contain p-8 transition-transform duration-700 ease-[cubic-bezier(.22,.61,.36,1)] group-hover:-translate-y-2 group-hover:scale-[1.07] motion-reduce:group-hover:translate-y-0 motion-reduce:group-hover:scale-100"
          />
          <span className="sr-only">View {product.name}</span>
        </Link>
        <div className="pointer-events-none absolute left-4 top-4 text-2xl text-black/25 transition-[transform,color] duration-500 group-hover:scale-125 group-hover:text-black/40">
          {product.arabic}
        </div>
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
        <div className="mt-5 flex flex-wrap gap-2">
          {product.tags.slice(0, 1).map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
          {soldOut && <Badge className="border-destructive/40 text-destructive">Sold out</Badge>}
          {lastFew !== null && (
            <Badge className="border-primary/40 text-primary">
              {lastFew === 1 ? "Last one" : `Only ${lastFew} left`}
            </Badge>
          )}
        </div>
      </CardContent>
      <CardFooter className="gap-3 pb-6 pt-5">
        <Button variant="outline" className="flex-1" onClick={onAdd} disabled={soldOut}>
          {soldOut ? "Sold out" : "Add to bag"}
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
              <div className="absolute inset-0 p-6">
                <Jar
                  productId={product.id}
                  image={product.image}
                  wrap={product.wrap}
                  alt={product.name}
                  sizes="(max-width: 640px) 100vw, 320px"
                  className="h-full w-full"
                />
              </div>
              <div className="pointer-events-none absolute left-5 top-5 text-3xl text-black/25">
                {product.arabic}
              </div>
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

/**
 * The loud moment.
 *
 * Every other section is measured; this one is not. Type at the largest size
 * the page allows, on the darkest surface, with the jar names as the whole
 * message. It exists to break the rhythm between the shop and the story so the
 * page has a peak rather than a flat line.
 */
/**
 * The jar, opened.
 *
 * Placed straight after the collection: by this point the visitor has seen what
 * is for sale, and this is the moment to show them what is inside one. Kabsah
 * is the lead product, so it is the one that opens.
 */
function OpenTheJar() {
  const product = products[0];
  return (
    <Showpiece
      productId={product.id}
      image={product.image}
      wrap={product.wrap}
      name={product.name}
      arabic={product.arabic}
      accent={product.accent}
      blurb={product.description}
    />
  );
}

function Statement() {
  return (
    <section className="relative overflow-hidden border-y border-black/40 bg-[#1b1a16] text-[#f5f0e7]">
      <div aria-hidden className="absolute inset-0 spice-field opacity-90" />
      <div aria-hidden className="absolute inset-0 grain" />
      <div className="relative mx-auto max-w-[1440px] px-5 py-24 lg:px-10 lg:py-32">
        <Reveal>
          <p className="text-[11px] font-semibold uppercase tracking-[.28em] text-white/70">Three pastes</p>
        </Reveal>
        <div className="mt-10">
          {products.map((product, i) => {
            // Alternating sides so the eye travels down the section instead of
            // running straight down one margin — and so the width gets used.
            const flipped = i % 2 === 1;
            return (
              <Reveal key={product.id} delay={i * 110} distance={40}>
                <Link
                  href={`/products/${product.slug}`}
                  className={cn(
                    "group flex flex-wrap items-baseline justify-between gap-x-8 border-b border-white/10 py-3 last:border-b-0",
                    flipped && "flex-row-reverse text-right",
                  )}
                >
                  <span className="font-serif text-[clamp(3rem,11.5vw,9.5rem)] leading-[.92] tracking-[-.06em] transition-colors duration-300 group-hover:text-primary">
                    {product.name.replace(" Paste", "")}.
                  </span>
                  <span aria-hidden className="font-serif text-3xl text-white/25 lg:text-5xl">
                    {product.arabic}
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>
        <Reveal delay={340}>
          <div className="mt-12 flex flex-wrap items-center gap-8 border-t border-white/12 pt-8">
            <p className="max-w-md text-sm leading-7 text-white/60">
              The dishes people gather for, reduced to one jar each. Open, sauté, serve.
            </p>
            <Button asChild variant="warm" size="lg" className="ml-auto">
              <Link href="#collection">See the range</Link>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Story() {
  const hero = products[0];
  return (
    <section id="story" className="bg-[#e7ddcd] px-5 py-20 lg:px-10 lg:py-28">
      <div className="mx-auto grid max-w-[1360px] gap-14 lg:grid-cols-2 lg:items-center">
        <Reveal className="relative aspect-[4/3] overflow-hidden rounded-lg bg-[#d8c8ac]" distance={32}>
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
        </Reveal>
        <Reveal className="max-w-xl lg:pl-12" delay={120}>
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
        </Reveal>
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
      <Reveal>
        <p className="eyebrow">Simple by design</p>
      </Reveal>
      <div className="mt-5 grid gap-0 border-y border-border lg:grid-cols-3">
        {steps.map(([n, t, d], i) => (
          <Reveal
            key={n}
            delay={i * 120}
            className="relative overflow-hidden border-b border-border py-9 lg:border-b-0 lg:border-r lg:px-10 first:pl-0 last:border-r-0"
          >
            {/* The step number as a background mark rather than a caption: it
                carries the counting at a glance and gives the row some scale. */}
            <span
              aria-hidden
              className="pointer-events-none absolute -top-6 right-2 font-serif text-[7rem] leading-none text-foreground/[.06] lg:text-[9rem]"
            >
              {n}
            </span>
            <span className="relative text-xs tracking-[.18em] text-muted-foreground">{n}</span>
            <h3 className="relative mt-8 font-serif text-4xl">{t}</h3>
            <p className="relative mt-3 text-sm text-muted-foreground">{d}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-[900px] px-5 py-20 lg:px-10 lg:py-28">
      <Reveal className="mb-10 text-center">
        <p className="eyebrow">Good to know</p>
        <h2 className="mt-3 font-serif text-5xl tracking-[-.04em] lg:text-6xl">Frequently asked.</h2>
      </Reveal>
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
