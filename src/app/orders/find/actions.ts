"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { issueOrderToken } from "@/lib/order-access";
import { orderStore } from "@/lib/orders";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Finds an order from its reference and the email it was placed with.
 *
 * The reference alone deliberately does not open an order — that is the whole
 * point of the signed links. Pairing it with the email is a second thing the
 * person has to know, and it is the one detail a customer looking for their own
 * order will always have.
 *
 * Throttled, because a form that confirms whether a reference exists is exactly
 * the shape of thing people script.
 */
export async function findOrder(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const h = await headers();
  const key = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";

  const gate = rateLimit(`order-lookup:${key}`, { limit: 10, windowMs: 10 * 60 * 1000 });
  if (!gate.allowed) {
    const minutes = Math.ceil(gate.retryInMs / 60000);
    return { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  const reference = String(formData.get("reference") ?? "")
    .trim()
    .toUpperCase();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!/^CA-[0-9A-Z]{6}$/.test(reference) || !email.includes("@")) {
    return { error: "Check the reference and email address, then try again." };
  }

  const order = await orderStore.byReference(reference);

  // One message whether the reference does not exist or the email does not
  // match. Telling them apart would turn this into a way to test which
  // references are real.
  if (!order || order.customer.email.toLowerCase() !== email) {
    return { error: "We could not find an order with that reference and email address." };
  }

  const token = issueOrderToken(order.reference);
  redirect(`/orders/${order.reference}${token ? `?t=${token}` : ""}`);
}
