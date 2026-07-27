"use client";
import Image from "next/image";
import { useMemo, useState } from "react";
import { Menu, Minus, Plus, ShoppingBag, ArrowRight, ShieldCheck, Truck, Clock3 } from "lucide-react";
import { products, type Product } from "@/lib/products";
import { money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type Cart = Record<string, number>;
export default function Marketplace(){
 const [cart,setCart]=useState<Cart>({});
 const count=Object.values(cart).reduce((a,b)=>a+b,0);
 const total=useMemo(()=>products.reduce((sum,p)=>sum+(cart[p.id]||0)*p.price,0),[cart]);
 const add=(id:string)=>setCart(c=>({...c,[id]:(c[id]||0)+1}));
 const change=(id:string,delta:number)=>setCart(c=>{const n=Math.max(0,(c[id]||0)+delta); const next={...c,[id]:n}; if(!n) delete next[id]; return next;});
 return <main className="min-h-screen overflow-hidden bg-background text-foreground">
  <header className="sticky top-0 z-40 border-b border-black/8 bg-[#f5f0e7]/92 backdrop-blur-xl">
   <div className="mx-auto flex h-18 max-w-[1440px] items-center justify-between px-5 lg:px-10">
    <button className="lg:hidden" aria-label="Open menu"><Menu className="size-5"/></button>
    <a href="#" className="flex items-baseline gap-2"><span className="font-serif text-[1.65rem] tracking-[-.04em]">Chef Ammar</span><span className="text-[10px] font-semibold uppercase tracking-[.22em] text-muted-foreground">Pantry</span></a>
    <nav className="hidden items-center gap-8 text-sm lg:flex"><a href="#collection">Shop</a><a href="#story">Our kitchen</a><a href="#guide">How to cook</a></nav>
    <CartSheet cart={cart} count={count} total={total} change={change}/>
   </div>
  </header>

  <section className="relative mx-auto grid max-w-[1440px] lg:min-h-[720px] lg:grid-cols-[.88fr_1.12fr]">
   <div className="flex flex-col justify-center px-6 py-18 lg:px-14 lg:py-24 xl:px-24">
    <p className="mb-6 text-xs font-semibold uppercase tracking-[.24em] text-[#8d3e2d]">Made for generous tables</p>
    <h1 className="max-w-2xl font-serif text-[clamp(3.6rem,7.4vw,7.5rem)] leading-[.88] tracking-[-.055em]">Arabian rice, made easier.</h1>
    <p className="mt-8 max-w-lg text-base leading-7 text-muted-foreground lg:text-lg">Chef-crafted cooking pastes with deep aroma, honest ingredients and enough flavour for the whole family.</p>
    <div className="mt-10 flex flex-wrap items-center gap-5"><Button variant="warm" size="lg" onClick={()=>document.getElementById("collection")?.scrollIntoView({behavior:"smooth"})}>Shop the collection <ArrowRight className="size-4"/></Button><span className="text-sm text-muted-foreground">From {money(19.9)} per jar</span></div>
   </div>
   <div className="relative min-h-[500px] overflow-hidden bg-[#ded2bd] lg:min-h-full">
    <div className="absolute inset-0 grain"/>
    <div className="absolute left-[8%] top-[11%] font-serif text-[10rem] leading-none text-black/[.04] lg:text-[17rem]">أ</div>
    <Image src="/products/hero.svg" alt="Chef Ammar cooking paste collection" fill priority className="object-cover object-center"/>
    <div className="absolute bottom-7 left-7 border-l border-black/30 pl-4 text-xs leading-5"><strong className="block uppercase tracking-[.18em]">Signature collection</strong><span className="text-black/55">Kabsah · Mandy · Briyani</span></div>
   </div>
  </section>

  <section className="border-y border-border bg-[#272821] text-[#f5f0e7]">
   <div className="mx-auto grid max-w-[1440px] grid-cols-1 divide-y divide-white/12 md:grid-cols-3 md:divide-x md:divide-y-0">
    <Feature icon={<Clock3/>} title="Dinner in less time" text="A practical shortcut without flattening the flavour."/>
    <Feature icon={<ShieldCheck/>} title="Kitchen-tested" text="Balanced recipes, created for consistent results."/>
    <Feature icon={<Truck/>} title="Delivered across Malaysia" text="Packed carefully and sent directly to your door."/>
   </div>
  </section>

  <section id="collection" className="mx-auto max-w-[1440px] px-5 py-20 lg:px-10 lg:py-28">
   <div className="mb-12 flex items-end justify-between gap-8"><div><p className="eyebrow">The pantry edit</p><h2 className="mt-3 font-serif text-5xl tracking-[-.04em] lg:text-7xl">Choose your favourite.</h2></div><p className="hidden max-w-sm text-sm leading-6 text-muted-foreground md:block">Distinct blends for different moods, all designed around the same promise: proper flavour without the complicated prep.</p></div>
   <div className="grid gap-x-5 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">{products.map(p=><ProductCard key={p.id} product={p} quantity={cart[p.id]||0} add={()=>add(p.id)}/>)}</div>
  </section>

  <section id="story" className="bg-[#e7ddcd] px-5 py-20 lg:px-10 lg:py-28"><div className="mx-auto grid max-w-[1360px] gap-14 lg:grid-cols-2 lg:items-center"><div className="relative aspect-[4/3] overflow-hidden bg-[#c8b596]"><Image src="/products/table.svg" alt="Arabian rice served at a family table" fill className="object-cover"/></div><div className="max-w-xl lg:pl-12"><p className="eyebrow">From Chef Ammar’s kitchen</p><h2 className="mt-4 font-serif text-5xl leading-[.98] tracking-[-.045em] lg:text-7xl">Good food should bring people closer.</h2><p className="mt-7 text-base leading-8 text-muted-foreground">This collection is built around the dishes people gather for. The paste handles the layering of aromatics and spice, so you can focus on the table, the people and the moment.</p><Button variant="outline" className="mt-9">Read our story <ArrowRight className="size-4"/></Button></div></div></section>

  <section id="guide" className="mx-auto max-w-[1440px] px-5 py-20 lg:px-10 lg:py-28"><p className="eyebrow">Simple by design</p><div className="mt-5 grid gap-0 border-y border-border lg:grid-cols-3">{[["01","Sauté","Cook the paste until fragrant."],["02","Build","Add protein, rice and water."],["03","Gather","Fluff, serve and bring everyone in."]].map(([n,t,d])=><div key={n} className="border-b border-border py-9 lg:border-b-0 lg:border-r lg:px-10 first:pl-0 last:border-r-0"><span className="text-xs text-muted-foreground">{n}</span><h3 className="mt-8 font-serif text-4xl">{t}</h3><p className="mt-3 text-sm text-muted-foreground">{d}</p></div>)}</div></section>

  <footer className="bg-[#1f201b] px-5 py-12 text-[#f5f0e7] lg:px-10"><div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-8 md:flex-row md:items-end"><div><div className="font-serif text-3xl">Chef Ammar</div><p className="mt-2 text-xs uppercase tracking-[.2em] text-white/45">Cook generously</p></div><p className="text-xs text-white/45">© 2026 Chef Ammar. Demo marketplace interface.</p></div></footer>
 </main>
}
function Feature({icon,title,text}:{icon:React.ReactNode,title:string,text:string}){return <div className="flex gap-4 px-6 py-7 lg:px-10"> <div className="mt-1 [&_svg]:size-4 [&_svg]:stroke-[1.5]">{icon}</div><div><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-xs leading-5 text-white/55">{text}</p></div></div>}
function ProductCard({product,quantity,add}:{product:Product,quantity:number,add:()=>void}){return <article className="group"><div className="relative aspect-[4/5] overflow-hidden" style={{backgroundColor:`${product.accent}1b`}}><Image src={product.image} alt={product.name} fill className="object-cover transition-transform duration-700 group-hover:scale-[1.025]"/><div className="absolute left-4 top-4 text-2xl text-black/25">{product.arabic}</div>{quantity>0&&<span className="absolute right-4 top-4 grid size-8 place-items-center bg-foreground text-xs text-background">{quantity}</span>}</div><div className="pt-5"><div className="flex items-start justify-between gap-4"><div><h3 className="font-serif text-2xl tracking-[-.02em]">{product.name}</h3><p className="mt-2 min-h-10 text-sm leading-5 text-muted-foreground">{product.description}</p></div><span className="pt-1 text-sm font-semibold">{money(product.price)}</span></div><div className="mt-5 flex gap-2">{product.tags.slice(0,1).map(t=><span key={t} className="border border-border px-2.5 py-1 text-[10px] uppercase tracking-[.12em] text-muted-foreground">{t}</span>)}</div><Button variant="outline" className="mt-5 w-full" onClick={add}>Add to bag</Button></div></article>}
function CartSheet({cart,count,total,change}:{cart:Cart,count:number,total:number,change:(id:string,d:number)=>void}){return <Sheet><SheetTrigger asChild><button className="relative flex items-center gap-2 text-sm"><ShoppingBag className="size-5 stroke-[1.6]"/><span className="hidden sm:inline">Bag</span>{count>0&&<span className="grid size-5 place-items-center rounded-full bg-foreground text-[10px] text-background">{count}</span>}</button></SheetTrigger><SheetContent><div className="flex h-full flex-col"><div className="border-b p-6 pr-16"><SheetHeader><SheetTitle>Your bag</SheetTitle><SheetDescription>{count?`${count} item${count>1?"s":""} selected`:"Your bag is waiting."}</SheetDescription></SheetHeader></div><div className="flex-1 overflow-y-auto p-6">{!count?<div className="grid h-full place-items-center text-center"><div><ShoppingBag className="mx-auto size-8 stroke-1 text-muted-foreground"/><p className="mt-4 font-serif text-2xl">Nothing here yet.</p><p className="mt-2 text-sm text-muted-foreground">Add a paste to start your order.</p></div></div>:<div className="space-y-6">{products.filter(p=>cart[p.id]).map(p=><div key={p.id} className="flex gap-4"><div className="relative size-24 shrink-0 overflow-hidden bg-muted"><Image src={p.image} alt="" fill className="object-cover"/></div><div className="flex flex-1 flex-col justify-between"><div className="flex justify-between gap-3"><div><h4 className="font-serif text-xl">{p.name}</h4><p className="mt-1 text-xs text-muted-foreground">{money(p.price)} each</p></div><strong className="text-sm">{money(p.price*cart[p.id])}</strong></div><div className="flex w-fit items-center border border-border"><button className="grid size-8 place-items-center" onClick={()=>change(p.id,-1)}><Minus className="size-3"/></button><span className="w-8 text-center text-xs">{cart[p.id]}</span><button className="grid size-8 place-items-center" onClick={()=>change(p.id,1)}><Plus className="size-3"/></button></div></div></div>)}</div>}</div>{count>0&&<div className="border-t p-6"><div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><strong>{money(total)}</strong></div><p className="mt-2 text-xs text-muted-foreground">Delivery calculated at checkout.</p><Separator className="my-5"/><Button variant="warm" size="lg" className="w-full">Continue to checkout <ArrowRight className="size-4"/></Button><p className="mt-4 text-center text-[10px] uppercase tracking-[.16em] text-muted-foreground">Secure checkout powered by CHIP</p></div>}</div></SheetContent></Sheet>}
