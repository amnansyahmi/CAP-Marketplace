"use client";

import Image from "next/image";
import Link from "next/link";
import { Minus, Plus } from "lucide-react";

import { useCart, type CartLine } from "@/lib/cart-context";
import { money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function CartSheet() {
  const { lines, count, subtotal, hydrated, bagOpen, setBagOpen } = useCart();

  return (
    <Sheet open={bagOpen} onOpenChange={setBagOpen}>
      <SheetTrigger asChild>
        <button className="text-sm tracking-[.02em]">
          Bag <span className="text-muted-foreground">({hydrated ? count : 0})</span>
        </button>
      </SheetTrigger>
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Your bag</SheetTitle>
          <SheetDescription>
            {count ? `${count} item${count > 1 ? "s" : ""} selected` : "Your bag is waiting."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-6">
          {!count ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <p className="font-serif text-3xl leading-tight">Nothing here yet.</p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">Add a paste to start your order.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {lines.map((line) => (
                <CartRow key={line.product.id} line={line} />
              ))}
            </div>
          )}
        </div>
        {count > 0 && (
          <SheetFooter>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <strong>{money(subtotal)}</strong>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Delivery calculated at checkout.</p>
            <Separator className="my-5" />
            <SheetClose asChild>
              <Button asChild variant="warm" size="lg" className="w-full">
                <Link href="/checkout">Continue to checkout</Link>
              </Button>
            </SheetClose>
            <p className="mt-4 text-center text-[10px] uppercase tracking-[.16em] text-muted-foreground">
              Secure checkout powered by CHIP
            </p>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CartRow({ line }: { line: CartLine }) {
  const { change } = useCart();
  const { product, quantity } = line;
  return (
    <div className="flex gap-4">
      <div
        className="relative size-24 shrink-0 overflow-hidden rounded-md"
        style={{ backgroundColor: `${product.accent}14` }}
      >
        <Image src={product.image} alt="" fill sizes="96px" className="object-contain p-1.5" />
      </div>
      <div className="flex flex-1 flex-col justify-between">
        <div className="flex justify-between gap-3">
          <div>
            <SheetClose asChild>
              <Link href={`/products/${product.slug}`} className="font-serif text-xl hover:text-primary">
                {product.name}
              </Link>
            </SheetClose>
            <p className="mt-1 text-xs text-muted-foreground">{money(product.price)} each</p>
          </div>
          <strong className="text-sm">{money(product.price * quantity)}</strong>
        </div>
        <div className="flex w-fit items-center overflow-hidden rounded-md border border-border">
          <button
            className="grid size-8 place-items-center transition-colors hover:bg-muted"
            onClick={() => change(product.id, -1)}
            aria-label={`Remove one ${product.name}`}
          >
            <Minus className="size-3" />
          </button>
          <span className="w-8 text-center text-xs">{quantity}</span>
          <button
            className="grid size-8 place-items-center transition-colors hover:bg-muted"
            onClick={() => change(product.id, 1)}
            aria-label={`Add one ${product.name}`}
          >
            <Plus className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
