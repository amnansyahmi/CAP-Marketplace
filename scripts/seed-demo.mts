/**
 * Demo data.
 *
 * Seeds through the real stores rather than hand-written SQL, so what a demo
 * shows is what the application actually produces — including agent fees,
 * affiliate attribution and shipping bands. Dates are backdated afterwards so
 * the dashboard has a history rather than everything landing in one minute.
 */

import { affiliateStore, commissionFor } from "@/lib/affiliates";
import { agentConfig, agentFeeFor, totalUnits } from "@/lib/agent";
import { getDb } from "@/lib/db/client";
import { orderStore, type Fulfilment, type OrderItem, type OrderStatus } from "@/lib/orders";
import { products } from "@/lib/products";
import { quoteShipping, round } from "@/lib/shipping";

type Person = { name: string; email: string; phone: string; city: string; state: string; postcode: string };

const PEOPLE: Person[] = [
  { name: "Nur Amina binti Hassan", email: "amina@example.com", phone: "012-345 6789", city: "Kuala Lumpur", state: "Kuala Lumpur", postcode: "55100" },
  { name: "Zulkifli bin Rahman", email: "zulkifli@example.com", phone: "013-222 8891", city: "Shah Alam", state: "Selangor", postcode: "40000" },
  { name: "Siti Nurhaliza Yusof", email: "siti@example.com", phone: "019-770 1123", city: "Johor Bahru", state: "Johor", postcode: "80000" },
  { name: "Tan Wei Ming", email: "weiming@example.com", phone: "016-889 2210", city: "George Town", state: "Pulau Pinang", postcode: "10200" },
  { name: "Faridah binti Omar", email: "faridah@example.com", phone: "011-3344 5566", city: "Kota Kinabalu", state: "Sabah", postcode: "88000" },
  { name: "Hafiz bin Ismail", email: "hafiz@example.com", phone: "017-654 3321", city: "Kuching", state: "Sarawak", postcode: "93000" },
  { name: "Mei Ling Chong", email: "meiling@example.com", phone: "012-908 7766", city: "Ipoh", state: "Perak", postcode: "30000" },
  { name: "Aisyah binti Kamal", email: "aisyah@example.com", phone: "014-556 7788", city: "Kuantan", state: "Pahang", postcode: "25000" },
  { name: "Rajesh Kumar", email: "rajesh@example.com", phone: "018-223 4455", city: "Melaka", state: "Melaka", postcode: "75000" },
  { name: "Noraini binti Salleh", email: "noraini@example.com", phone: "013-889 0011", city: "Alor Setar", state: "Kedah", postcode: "05000" },
];

const AFFILIATES = [
  { code: "AMINA10", name: "Amina Rahim", email: "amina.affiliate@example.com", phone: "012-300 4455", commissionRate: 0.1 },
  { code: "DAPURKITA", name: "Dapur Kita", email: "hello@dapurkita.example.com", phone: "03-8899 1122", commissionRate: 0.125 },
  { code: "CHEFCLUB", name: "Chef Club MY", email: "team@chefclub.example.com", commissionRate: 0.08 },
];

/** Deterministic pseudo-random, so a demo looks the same each time it is seeded. */
function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

export async function seedDemoData() {
  const db = await getDb();

  // Only seed an empty shop: re-running must not double the figures.
  const existing = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM orders`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    const affiliates = await affiliateStore.list();
    const all = await orderStore.list({ limit: 200 });
    return {
      affiliates: affiliates.length,
      orders: all.total,
      paid: all.orders.filter((o) => o.status === "paid").length,
      referred: all.orders.filter((o) => o.affiliateCode).length,
      skipped: true,
    };
  }

  for (const input of AFFILIATES) await affiliateStore.create(input);
  const affiliates = await affiliateStore.list();

  const random = seededRandom(20260728);
  const agent = agentConfig();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  let referred = 0;
  let paid = 0;
  const total = 32;

  for (let i = 0; i < total; i++) {
    const person = PEOPLE[Math.floor(random() * PEOPLE.length)];

    // One to three products, one to four jars each.
    const lineCount = 1 + Math.floor(random() * 2.4);
    const chosen = [...products].sort(() => random() - 0.5).slice(0, lineCount);
    const items: OrderItem[] = chosen.map((product) => {
      const quantity = 1 + Math.floor(random() * 4);
      return {
        productId: product.id,
        name: product.name,
        unitPrice: product.price,
        quantity,
        lineTotal: round(product.price * quantity),
      };
    });

    const subtotal = round(items.reduce((sum, i) => sum + i.lineTotal, 0));
    const quote = quoteShipping(subtotal, person.state)!;

    // Roughly two in five arrive through a referral link.
    const affiliate = random() < 0.4 ? affiliates[Math.floor(random() * affiliates.length)] : undefined;
    if (affiliate) referred++;

    const fee = agentFeeFor(totalUnits(items), agent);

    const order = await orderStore.create({
      items,
      customer: { fullName: person.name, email: person.email, phone: person.phone },
      address: {
        line1: `${1 + Math.floor(random() * 200)} Jalan ${["Merdeka", "Bunga Raya", "Seri Indah", "Damai", "Cempaka"][Math.floor(random() * 5)]}`,
        postcode: person.postcode,
        city: person.city,
        state: person.state,
      },
      subtotal,
      shipping: quote.fee,
      total: round(subtotal + quote.fee),
      currency: "MYR",
      ...(affiliate
        ? {
            affiliateId: affiliate.id,
            affiliateCode: affiliate.code,
            commissionRate: affiliate.commissionRate,
            commissionAmount: commissionFor(subtotal, affiliate.commissionRate),
          }
        : {}),
      ...(fee > 0 ? { agentName: agent.name, agentFee: fee } : {}),
    });

    // A realistic mix rather than everything settled.
    const roll = random();
    let status: OrderStatus = "paid";
    if (roll > 0.92) status = "failed";
    else if (roll > 0.84) status = "pending_payment";

    if (status !== "pending_payment") await orderStore.setStatus(order.id, status);
    if (status === "paid") {
      paid++;
      const progress = random();
      const fulfilment: Fulfilment =
        progress > 0.65 ? "delivered" : progress > 0.4 ? "shipped" : progress > 0.2 ? "packed" : "unfulfilled";
      if (fulfilment !== "unfulfilled") {
        await orderStore.setFulfilment(
          order.id,
          fulfilment,
          fulfilment === "unfulfilled" || fulfilment === "packed" ? null : `MY${100000000 + Math.floor(random() * 899999999)}`,
        );
      }
    }

    // Spread across the last eight weeks so charts and date filters have range.
    const placedAt = new Date(now - Math.floor(random() * 56) * DAY - Math.floor(random() * DAY));
    await db.query(
      // $2 is cast explicitly: it appears in three positions and Postgres
      // cannot infer a single type for the parameter across them.
      `UPDATE orders
          SET created_at = $2::timestamptz,
              paid_at = CASE WHEN paid_at IS NOT NULL THEN $2::timestamptz ELSE NULL END,
              fulfilment_updated_at = CASE
                WHEN fulfilment_updated_at IS NOT NULL THEN $2::timestamptz ELSE NULL END
        WHERE id = $1`,
      [order.id, placedAt.toISOString()],
    );
  }

  // Settle one affiliate's commission, so the demo shows both owed and paid.
  if (affiliates[0]) await affiliateStore.payOut(affiliates[0].id);

  return { affiliates: affiliates.length, orders: total, paid, referred, skipped: false };
}
