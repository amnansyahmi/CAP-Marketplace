/**
 * Order model and store.
 *
 * The store is deliberately kept behind a small interface: today it is an
 * in-process Map, which is enough to run the whole purchase flow locally but
 * does NOT survive a restart and is not shared between serverless instances.
 * Swapping in Supabase/Postgres means reimplementing `OrderStore` only — no
 * caller changes.
 */

import { randomUUID } from "node:crypto";

export type OrderStatus = "pending_payment" | "paid" | "failed" | "cancelled";

export type OrderItem = {
  productId: string;
  name: string;
  /** Unit price at the time of purchase, in ringgit. */
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type Customer = {
  fullName: string;
  email: string;
  phone: string;
};

export type DeliveryAddress = {
  line1: string;
  line2?: string;
  postcode: string;
  city: string;
  state: string;
};

export type Order = {
  id: string;
  /** Short human-facing code shown to the customer and used in URLs. */
  reference: string;
  status: OrderStatus;
  items: OrderItem[];
  customer: Customer;
  address: DeliveryAddress;
  notes?: string;
  subtotal: number;
  shipping: number;
  total: number;
  currency: "MYR";
  /** CHIP purchase id, once a payment has been created for this order. */
  paymentId?: string;
  paymentUrl?: string;
  createdAt: string;
  paidAt?: string;
};

export interface OrderStore {
  create(order: Order): Promise<Order>;
  byReference(reference: string): Promise<Order | undefined>;
  byPaymentId(paymentId: string): Promise<Order | undefined>;
  update(id: string, patch: Partial<Order>): Promise<Order | undefined>;
}

class MemoryOrderStore implements OrderStore {
  // Survives hot reloads in dev by hanging off globalThis rather than a module local.
  private get orders(): Map<string, Order> {
    const g = globalThis as { __chefAmmarOrders?: Map<string, Order> };
    if (!g.__chefAmmarOrders) g.__chefAmmarOrders = new Map();
    return g.__chefAmmarOrders;
  }

  async create(order: Order) {
    this.orders.set(order.id, order);
    return order;
  }

  async byReference(reference: string) {
    return [...this.orders.values()].find((o) => o.reference === reference);
  }

  async byPaymentId(paymentId: string) {
    return [...this.orders.values()].find((o) => o.paymentId === paymentId);
  }

  async update(id: string, patch: Partial<Order>) {
    const existing = this.orders.get(id);
    if (!existing) return undefined;
    const next = { ...existing, ...patch };
    this.orders.set(id, next);
    return next;
  }
}

export const orderStore: OrderStore = new MemoryOrderStore();

export function newOrderId() {
  return randomUUID();
}

/** e.g. CA-7F3K9Q — short enough to read down the phone. */
export function newOrderReference() {
  const alphabet = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid misreads
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `CA-${out}`;
}

/**
 * Paid is terminal for our purposes: once money has landed, a late `failed`
 * webhook must not silently undo it.
 */
export function canTransition(from: OrderStatus, to: OrderStatus) {
  if (from === to) return true;
  if (from === "paid") return false;
  return true;
}
