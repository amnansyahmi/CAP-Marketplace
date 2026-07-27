/**
 * CHIP Collect integration (https://www.chip-in.asia/).
 *
 * Everything that touches CHIP's wire format lives in this file, so adapting to
 * their live API means editing one module.
 *
 * !! BEFORE GOING LIVE: confirm the request/response field names and the
 * webhook signature scheme below against CHIP's current API reference. The
 * shape here follows the documented Purchases API (amounts in sen, Bearer
 * secret key, `checkout_url` in the response) but has not been exercised
 * against a real merchant account.
 *
 * Required environment variables:
 *   CHIP_BRAND_ID    – brand UUID from the CHIP dashboard
 *   CHIP_SECRET_KEY  – secret API key (server-side only, never expose)
 *   CHIP_PUBLIC_KEY  – PEM public key used to verify webhook signatures
 *   CHIP_API_URL     – optional override, defaults to production gateway
 *
 * With no credentials configured the module runs in simulation mode: orders are
 * created and the customer is routed straight to the confirmation page. This
 * keeps the shop runnable in development; it must never be relied on in
 * production, which is why `isLive` is surfaced to callers and the UI labels it.
 */

import { createVerify, timingSafeEqual } from "node:crypto";

import type { Order } from "@/lib/orders";
import { toSen } from "@/lib/shipping";

const API_URL = process.env.CHIP_API_URL ?? "https://gate.chip-in.asia/api/v1";

export function chipConfig() {
  const brandId = process.env.CHIP_BRAND_ID;
  const secretKey = process.env.CHIP_SECRET_KEY;
  return { brandId, secretKey, isLive: Boolean(brandId && secretKey) };
}

export type PurchaseResult = {
  paymentId: string;
  checkoutUrl: string;
  /** False when the payment was simulated because CHIP is not configured. */
  live: boolean;
};

export async function createPurchase(
  order: Order,
  urls: { successUrl: string; failureUrl: string; callbackUrl: string },
): Promise<PurchaseResult> {
  const { brandId, secretKey, isLive } = chipConfig();

  if (!isLive) {
    return {
      paymentId: `sim_${order.id}`,
      checkoutUrl: urls.successUrl,
      live: false,
    };
  }

  // Send the shipping charge as its own line so the CHIP-side total reconciles
  // with the order total rather than being silently folded into a product.
  const productLines = order.items.map((item) => ({
    name: `${item.name} (${item.quantity} x)`,
    price: toSen(item.unitPrice),
    quantity: item.quantity,
  }));
  if (order.shipping > 0) {
    productLines.push({ name: "Delivery", price: toSen(order.shipping), quantity: 1 });
  }

  const response = await fetch(`${API_URL}/purchases/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      brand_id: brandId,
      reference: order.reference,
      client: {
        email: order.customer.email,
        full_name: order.customer.fullName,
        phone: order.customer.phone,
      },
      purchase: {
        currency: order.currency,
        products: productLines,
      },
      success_redirect: urls.successUrl,
      failure_redirect: urls.failureUrl,
      success_callback: urls.callbackUrl,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`CHIP purchase failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const data = (await response.json()) as { id?: string; checkout_url?: string };
  if (!data.id || !data.checkout_url) {
    throw new Error("CHIP purchase response missing id or checkout_url");
  }

  return { paymentId: data.id, checkoutUrl: data.checkout_url, live: true };
}

/**
 * Verify a webhook came from CHIP.
 *
 * Must be called with the *raw* request body — re-serialising parsed JSON
 * changes the bytes and will fail an otherwise valid signature.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const publicKey = process.env.CHIP_PUBLIC_KEY;
  if (!publicKey || !signature) return false;

  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(rawBody, "utf8");
    verifier.end();
    const ok = verifier.verify(publicKey.replace(/\\n/g, "\n"), Buffer.from(signature, "base64"));
    // Constant-time compare of the boolean result keeps the branch uniform.
    return timingSafeEqual(Buffer.from([ok ? 1 : 0]), Buffer.from([1]));
  } catch {
    return false;
  }
}
