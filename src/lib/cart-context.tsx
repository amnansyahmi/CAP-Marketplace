"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { products, productById, type Product } from "@/lib/products";
import { round } from "@/lib/shipping";

const STORAGE_KEY = "chef-ammar-bag";

export type CartLine = { product: Product; quantity: number };

type CartState = Record<string, number>;

type CartValue = {
  lines: CartLine[];
  count: number;
  subtotal: number;
  /** True until the persisted bag has been read, so SSR and first paint agree. */
  hydrated: boolean;
  add: (product: Product, quantity?: number) => void;
  setQuantity: (id: string, quantity: number) => void;
  change: (id: string, delta: number) => void;
  remove: (id: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartValue | null>(null);

/** Drops unknown ids and non-positive counts so a stale bag can't resurrect a delisted product. */
function sanitise(raw: unknown): CartState {
  if (!raw || typeof raw !== "object") return {};
  const next: CartState = {};
  for (const [id, qty] of Object.entries(raw as Record<string, unknown>)) {
    const n = Math.floor(Number(qty));
    if (productById(id) && Number.isFinite(n) && n > 0) next[id] = Math.min(n, 99);
  }
  return next;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CartState>({});
  const [hydrated, setHydrated] = useState(false);

  // Read once on mount rather than during render — the server has no
  // localStorage, and reading it inline would desync the first paint.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setState(sanitise(JSON.parse(stored)));
    } catch {
      // A corrupt or unavailable bag should never block the shop from loading.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private browsing / quota — the bag just won't survive a refresh.
    }
  }, [state, hydrated]);

  const setQuantity = useCallback((id: string, quantity: number) => {
    setState((c) => {
      const next = { ...c };
      const n = Math.max(0, Math.min(99, Math.floor(quantity)));
      if (n === 0) delete next[id];
      else next[id] = n;
      return next;
    });
  }, []);

  const add = useCallback((product: Product, quantity = 1) => {
    setState((c) => ({ ...c, [product.id]: Math.min(99, (c[product.id] || 0) + quantity) }));
  }, []);

  const change = useCallback((id: string, delta: number) => {
    setState((c) => {
      const n = Math.max(0, Math.min(99, (c[id] || 0) + delta));
      const next = { ...c };
      if (n === 0) delete next[id];
      else next[id] = n;
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setState((c) => {
      const next = { ...c };
      delete next[id];
      return next;
    });
  }, []);

  const clear = useCallback(() => setState({}), []);

  const value = useMemo<CartValue>(() => {
    // Iterate the catalogue so bag order stays stable as quantities change.
    const lines = products
      .filter((p) => state[p.id])
      .map((product) => ({ product, quantity: state[product.id] }));
    return {
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      subtotal: round(lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0)),
      hydrated,
      add,
      setQuantity,
      change,
      remove,
      clear,
    };
  }, [state, hydrated, add, setQuantity, change, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
