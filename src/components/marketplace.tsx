"use client";
import Image from "next/image";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Menu, Minus, Plus, ShoppingBag, ArrowRight, ShieldCheck, Truck, Clock3, Eye } from "lucide-react";
import { products, type Product } from "@/lib/products";
import { money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type Cart = Record<string, number>;

const faqs = [
  { q: "How long does delivery take?", a: "Orders across Peninsular Malaysia arrive within 2-4 working days. East Malaysia may take a little longer." },
  { q: "How should I store the paste?", a: "Refrigerate after opening and use within the date on the label. Unopened jars keep well in a cool, dry pantry." },
  { q: "Can I adjust the spice level?", a: "Yes — each paste is a flavour base. Use less for a milder dish or extra for more heat and depth." },
  { q: "How many servings does one jar make?", a: "One jar seasons roughly 1kg of rice or protein, enough for 4-5 generous servings." },
];

export default function Marketplace() {
  const [cart, setCart] = useState<Cart>({});
  const [quickView, setQuickView] = useState<Product | null>(null);
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const total = useMemo(() => products.reduce((sum, p) => sum + (cart[p.id] || 0) * p.price, 0), [cart]);
  const startingPrice = useMemo(() => Math.min(...products.map((p) => p.price)), []);

  const add = (product: Product) => {
    setCart((c) => ({ ...c, [product.id]: (c[product.id] || 0) + 1 }));
    toast.success(`${product.name} added to bag`);
  };
  const change = (id: string, delta: number) =>
    setCart((c) => {
      const n = Math.max(0, (c[id] || 0) + delta);
      const next = { ...c, [id]: n };
      if (!n) delete next[id];
      return next;
    });

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <Header count={count} cart={cart} total={total} change={change} />
      <Hero startingPrice={startingPrice} />
      <Features />
      <Collection cart={cart} onAdd={add} onQuickView={setQuickView} />
      <Story />
      <Guide />
      <Faq />
      <Footer />
      <QuickViewDialog
        product={quickView}
        quantity={quickView ? cart[quickView.id] || 0 : 0}
        onOpenChange={(open) => !open && setQuickView(null)}
        onAdd={add}
      />
    </main>
  );
}

function Header({ count, cart, total, change }: { count: number; cart: Cart; total: number; change: (id: string, d: number) => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-black/8 bg-[#f5f0e7]/92 backdrop-blur-xl">
      <div className="mx-auto flex h-18 max-w-[1440px] items-center justify-between px-5 lg:px-10">
        <button className="lg:hidden" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <a href="#" className="flex items-baseline gap-2">
          <span className="font-serif text-[1.65rem] tracking-[-.04em]">Chef Ammar</span>
          <span className="text-[10px] font-semibold uppercase tracking-[.22em] text-muted-foreground">Pantry</span>
        </a>
        <nav className="hidden items-center gap-8 text-sm lg:flex">
          <a href="#collection">Shop</a>
          <a href="#story">Our kitchen</a>
          <a href="#guide">How to cook</a>
          <a href="#faq">FAQs</a>
        </nav>
        <CartSheet count={count} cart={cart} total={total} change={change} />
      </div>
    </header>
  );
}

function Hero({ startingPrice }: { startingPrice: number }) {
  return (
    <section className="relative mx-auto grid max-w-[1440px] lg:min-h-[720px] lg:grid-cols-[.88fr_1.12fr]">
      <div className="flex flex-col justify-center px-6 py-18 lg:px-14 lg:py-24 xl:px-24">
        <Badge variant="outline" className="mb-6 w-fit">
          Made for generous tables
        </Badge>
        <h1 className="max-w-2xl font-serif text-[clamp(3.6rem,7.4vw,7.5rem)] leading-[.88] tracking-[-.055em]">Arabian rice, made easier.</h1>
        <p className="mt-8 max-w-lg text-base leading-7 text-muted-foreground lg:text-lg">
          Chef-crafted cooking pastes with deep aroma, honest ingredients and enough flavour for the whole family.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-5">
          <Button variant="warm" size="lg" onClick={() => document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" })}>
            Shop the collection <ArrowRight className="size-4" />
          </Button>
          <span className="text-sm text-muted-foreground">From {money(startingPrice)} per jar</span>
        </div>
      </div>
      <div className="relative min-h-[500px] overflow-hidden bg-[#ded2bd] lg:min-h-full">
        <div className="absolute inset-0 grain" />
        <div className="absolute left-[8%] top-[11%] font-serif text-[10rem] leading-none text-black/[.04] lg:text-[17rem]">أ</div>
        <Image src="/products/hero.svg" alt="Chef Ammar cooking paste collection" fill priority className="object-cover object-center" />
        <div className="absolute bottom-7 left-7 border-l border-black/30 pl-4 text-xs leading-5">
          <strong className="block uppercase tracking-[.18em]">Signature collection</strong>
          <span className="text-black/55">Kabsah · Mandy · Briyani</span>
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="border-y border-border bg-[#272821] text-[#f5f0e7]">
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 divide-y divide-white/12 md:grid-cols-3 md:divide-x md:divide-y-0">
        <Feature icon={<Clock3 />} title="Dinner in less time" text="A practical shortcut without flattening the flavour." />
        <Feature icon={<ShieldCheck />} title="Kitchen-tested" text="Balanced recipes, created for consistent results." />
        <Feature icon={<Truck />} title="Delivered across Malaysia" text="Packed carefully and sent directly to your door." />
      </div>
    </section>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-4 px-6 py-7 lg:px-10">
      <div className="mt-1 [&_svg]:size-4 [&_svg]:stroke-[1.5]">{icon}</div>
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-white/55">{text}</p>
      </div>
    </div>
  );
}

function Collection({ cart, onAdd, onQuickView }: { cart: Cart; onAdd: (p: Product) => void; onQuickView: (p: Product) => void }) {
  return (
    <section id="collection" className="mx-auto max-w-[1440px] px-5 py-20 lg:px-10 lg:py-28">
      <div className="mb-12 flex items-end justify-between gap-8">
        <div>
          <p className="eyebrow">The pantry edit</p>
          <h2 className="mt-3 font-serif text-5xl tracking-[-.04em] lg:text-7xl">Choose your favourite.</h2>
        </div>
        <p className="hidden max-w-sm text-sm leading-6 text-muted-foreground md:block">
          Distinct blends for different moods, all designed around the same promise: proper flavour without the complicated prep.
        </p>
      </div>
      <div className="grid gap-x-5 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} quantity={cart[p.id] || 0} onAdd={() => onAdd(p)} onQuickView={() => onQuickView(p)} />
        ))}
      </div>
    </section>
  );
}

function ProductCard({ product, quantity, onAdd, onQuickView }: { product: Product; quantity: number; onAdd: () => void; onQuickView: () => void }) {
  return (
    <Card className="group gap-0 overflow-hidden">
      <div className="relative aspect-[4/5] overflow-hidden" style={{ backgroundColor: `${product.accent}1b` }}>
        <Image src={product.image} alt={product.name} fill className="object-cover transition-transform duration-700 group-hover:scale-[1.025]" />
        <div className="absolute left-4 top-4 text-2xl text-black/25">{product.arabic}</div>
        {quantity > 0 && (
          <Badge variant="secondary" className="absolute right-4 top-4">
            {quantity} in bag
          </Badge>
        )}
        <button
          onClick={onQuickView}
          aria-label={`Quick view ${product.name}`}
          className="absolute inset-x-4 bottom-4 flex items-center justify-center gap-2 border border-border bg-background/90 py-2.5 text-xs font-semibold uppercase tracking-[.14em] opacity-0 backdrop-blur transition-opacity duration-300 group-hover:opacity-100"
        >
          <Eye className="size-3.5" /> Quick view
        </button>
      </div>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-serif text-2xl tracking-[-.02em]">{product.name}</h3>
            <p className="mt-2 min-h-10 text-sm leading-5 text-muted-foreground">{product.description}</p>
          </div>
          <span className="pt-1 text-sm font-semibold">{money(product.price)}</span>
        </div>
        <div className="mt-5 flex gap-2">
          {product.tags.slice(0, 1).map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      </CardContent>
      <CardFooter className="pb-6 pt-5">
        <Button variant="outline" className="w-full" onClick={onAdd}>
          Add to bag
        </Button>
      </CardFooter>
    </Card>
  );
}

function QuickViewDialog({ product, quantity, onOpenChange, onAdd }: { product: Product | null; quantity: number; onOpenChange: (open: boolean) => void; onAdd: (p: Product) => void }) {
  return (
    <Dialog open={!!product} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 p-0">
        {product && (
          <div className="grid sm:grid-cols-2">
            <div className="relative aspect-square sm:aspect-auto" style={{ backgroundColor: `${product.accent}1b` }}>
              <Image src={product.image} alt={product.name} fill className="object-cover" />
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
                <DialogDescription className="text-base leading-7">{product.longDescription}</DialogDescription>
              </DialogHeader>
              <div className="mt-auto flex items-center justify-between pt-6">
                <span className="font-serif text-3xl">{money(product.price)}</span>
                {quantity > 0 && <span className="text-xs text-muted-foreground">{quantity} in bag</span>}
              </div>
              <DialogFooter className="mt-4">
                <Button variant="warm" size="lg" className="w-full" onClick={() => onAdd(product)}>
                  Add to bag <ArrowRight className="size-4" />
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
  return (
    <section id="story" className="bg-[#e7ddcd] px-5 py-20 lg:px-10 lg:py-28">
      <div className="mx-auto grid max-w-[1360px] gap-14 lg:grid-cols-2 lg:items-center">
        <div className="relative aspect-[4/3] overflow-hidden bg-[#c8b596]">
          <Image src="/products/table.svg" alt="Arabian rice served at a family table" fill className="object-cover" />
        </div>
        <div className="max-w-xl lg:pl-12">
          <p className="eyebrow">From Chef Ammar&rsquo;s kitchen</p>
          <h2 className="mt-4 font-serif text-5xl leading-[.98] tracking-[-.045em] lg:text-7xl">Good food should bring people closer.</h2>
          <p className="mt-7 text-base leading-8 text-muted-foreground">
            This collection is built around the dishes people gather for. The paste handles the layering of aromatics and spice, so you can focus on the table, the people and the moment.
          </p>
          <Button variant="outline" className="mt-9">
            Read our story <ArrowRight className="size-4" />
          </Button>
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

function Footer() {
  return (
    <footer className="bg-[#1f201b] px-5 py-16 text-[#f5f0e7] lg:px-10">
      <div className="mx-auto grid max-w-[1440px] gap-10 md:grid-cols-[1.2fr_1fr] md:items-end">
        <div>
          <div className="font-serif text-3xl">Chef Ammar</div>
          <p className="mt-2 text-xs uppercase tracking-[.2em] text-white/45">Cook generously</p>
          <p className="mt-6 max-w-sm text-sm leading-6 text-white/60">Get new recipes and early access to seasonal blends, straight to your inbox.</p>
        </div>
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(e) => e.preventDefault()}>
          <div className="flex-1">
            <Label htmlFor="newsletter-email" className="sr-only">
              Email address
            </Label>
            <Input id="newsletter-email" type="email" required placeholder="you@email.com" className="border-white/20 bg-white/5 text-white placeholder:text-white/40" />
          </div>
          <Button type="submit" variant="warm">
            Subscribe
          </Button>
        </form>
      </div>
      <Separator className="my-10 bg-white/12" />
      <div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-3 text-xs text-white/45 md:flex-row">
        <p>© 2026 Chef Ammar. Demo marketplace interface.</p>
        <p>Payments secured by CHIP.</p>
      </div>
    </footer>
  );
}

function CartSheet({ count, cart, total, change }: { count: number; cart: Cart; total: number; change: (id: string, d: number) => void }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button className="relative flex items-center gap-2 text-sm">
          <ShoppingBag className="size-5 stroke-[1.6]" />
          <span className="hidden sm:inline">Bag</span>
          {count > 0 && <span className="grid size-5 place-items-center rounded-full bg-foreground text-[10px] text-background">{count}</span>}
        </button>
      </SheetTrigger>
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Your bag</SheetTitle>
          <SheetDescription>{count ? `${count} item${count > 1 ? "s" : ""} selected` : "Your bag is waiting."}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-6">
          {!count ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <ShoppingBag className="mx-auto size-8 stroke-1 text-muted-foreground" />
                <p className="mt-4 font-serif text-2xl">Nothing here yet.</p>
                <p className="mt-2 text-sm text-muted-foreground">Add a paste to start your order.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {products
                .filter((p) => cart[p.id])
                .map((p) => (
                  <CartLine key={p.id} product={p} quantity={cart[p.id]} change={change} />
                ))}
            </div>
          )}
        </div>
        {count > 0 && (
          <SheetFooter>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <strong>{money(total)}</strong>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Delivery calculated at checkout.</p>
            <Separator className="my-5" />
            <Button variant="warm" size="lg" className="w-full">
              Continue to checkout <ArrowRight className="size-4" />
            </Button>
            <p className="mt-4 text-center text-[10px] uppercase tracking-[.16em] text-muted-foreground">Secure checkout powered by CHIP</p>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CartLine({ product, quantity, change }: { product: Product; quantity: number; change: (id: string, d: number) => void }) {
  return (
    <div className="flex gap-4">
      <div className="relative size-24 shrink-0 overflow-hidden bg-muted">
        <Image src={product.image} alt="" fill className="object-cover" />
      </div>
      <div className="flex flex-1 flex-col justify-between">
        <div className="flex justify-between gap-3">
          <div>
            <h4 className="font-serif text-xl">{product.name}</h4>
            <p className="mt-1 text-xs text-muted-foreground">{money(product.price)} each</p>
          </div>
          <strong className="text-sm">{money(product.price * quantity)}</strong>
        </div>
        <div className="flex w-fit items-center border border-border">
          <button className="grid size-8 place-items-center" onClick={() => change(product.id, -1)} aria-label={`Remove one ${product.name}`}>
            <Minus className="size-3" />
          </button>
          <span className="w-8 text-center text-xs">{quantity}</span>
          <button className="grid size-8 place-items-center" onClick={() => change(product.id, 1)} aria-label={`Add one ${product.name}`}>
            <Plus className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
