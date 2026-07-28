"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { clearThrottle, throttle, verifyPassword } from "@/lib/admin/auth";
import { endSession, isAdmin, requireAdmin, startSession } from "@/lib/admin/session";
import { FULFILMENT_STEPS, orderStore, type Fulfilment, type OrderStatus } from "@/lib/orders";
import { affiliateStore, normaliseCode } from "@/lib/affiliates";

/** Best-effort client identity for throttling. */
async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function login(_prev: { error?: string } | undefined, formData: FormData) {
  const key = await clientKey();
  const gate = throttle(key);
  if (!gate.allowed) {
    const minutes = Math.ceil(gate.retryInMs / 60000);
    return { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  const password = String(formData.get("password") ?? "");
  if (!verifyPassword(password)) {
    // Deliberately does not say whether admin is configured or the password was
    // simply wrong — that distinction is useful to an attacker.
    return { error: "Incorrect password." };
  }

  if (!(await startSession())) return { error: "Admin is not configured on this environment." };
  clearThrottle(key);
  redirect("/admin");
}

export async function logout() {
  await endSession();
  redirect("/admin/login");
}

function parseFulfilment(value: unknown): Fulfilment | null {
  return FULFILMENT_STEPS.includes(value as Fulfilment) ? (value as Fulfilment) : null;
}

export async function updateFulfilment(formData: FormData) {
  // Re-checked here rather than trusting the layout: a server action is an
  // endpoint and can be invoked without ever rendering the page.
  await requireAdmin();

  const id = String(formData.get("orderId") ?? "");
  const fulfilment = parseFulfilment(formData.get("fulfilment"));
  const trackingRaw = String(formData.get("trackingNumber") ?? "").trim();

  if (!id || !fulfilment) return;

  // The store refuses to fulfil an unpaid order, so no check is needed here.
  const updated = await orderStore.setFulfilment(id, fulfilment, trackingRaw || null);

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  // The detail page is a dynamic segment, and revalidating "/admin/orders" does
  // not cover "/admin/orders/CA-XXXXXX" — without this the page the change was
  // made from keeps showing the previous state.
  if (updated) revalidatePath(`/admin/orders/${updated.reference}`);
}

export async function updateStatus(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("orderId") ?? "");
  const status = String(formData.get("status") ?? "") as OrderStatus;
  // Only cancelling is offered from the admin UI; payment states belong to the
  // gateway, and the store refuses to move a settled order regardless.
  if (!id || status !== "cancelled") return;

  const updated = await orderStore.setStatus(id, status);
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  if (updated) revalidatePath(`/admin/orders/${updated.reference}`);
}

/** Used by the layout to decide between the app shell and a redirect. */
export async function adminSignedIn() {
  return isAdmin();
}

// --- affiliates --------------------------------------------------------------

export async function createAffiliate(
  _prev: { error?: string; ok?: string } | undefined,
  formData: FormData,
) {
  await requireAdmin();

  const code = String(formData.get("code") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  // Entered as a percentage because that is how people discuss it; stored as a
  // fraction because that is how it is multiplied.
  const percent = Number(formData.get("commissionPercent"));

  if (!normaliseCode(code)) return { error: "Code must be 3-24 letters, digits or dashes." };
  if (name.length < 2) return { error: "Enter the affiliate's name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: "Enter a valid email address." };
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { error: "Commission must be between 0 and 100 percent." };
  }

  try {
    await affiliateStore.create({
      code,
      name,
      email,
      phone: phone || undefined,
      commissionRate: percent / 100,
    });
  } catch (error) {
    const code23505 = (error as { code?: string }).code === "23505";
    return { error: code23505 ? "That referral code is already taken." : "Could not create the affiliate." };
  }

  revalidatePath("/admin/affiliates");
  return { ok: "Affiliate added." };
}

export async function setAffiliateActive(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("affiliateId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return;
  const updated = await affiliateStore.setActive(id, active);
  revalidatePath("/admin/affiliates");
  if (updated) revalidatePath(`/admin/affiliates/${updated.code}`);
}

export async function setAffiliateRate(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("affiliateId") ?? "");
  const percent = Number(formData.get("commissionPercent"));
  if (!id || !Number.isFinite(percent) || percent < 0 || percent > 100) return;
  // Applies to future orders only — existing orders keep their snapshotted rate.
  const updated = await affiliateStore.setRate(id, percent / 100);
  revalidatePath("/admin/affiliates");
  if (updated) revalidatePath(`/admin/affiliates/${updated.code}`);
}

export async function payOutAffiliate(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("affiliateId") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!id) return;
  // The store only settles commission on orders that were actually paid, and
  // will not pay the same commission twice.
  await affiliateStore.payOut(id);
  revalidatePath("/admin/affiliates");
  if (code) revalidatePath(`/admin/affiliates/${code}`);
}
