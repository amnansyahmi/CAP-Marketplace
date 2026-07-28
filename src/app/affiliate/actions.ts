"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { clearThrottle, throttle } from "@/lib/affiliate/auth";
import { endAffiliateSession, startAffiliateSession } from "@/lib/affiliate/session";
import { affiliateStore, normaliseCode } from "@/lib/affiliates";
import { adminAuthBypassed } from "@/lib/environment";

/** Best-effort client identity for throttling. */
async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function affiliateLogin(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const key = await clientKey();
  const gate = throttle(key);
  if (!gate.allowed) {
    const minutes = Math.ceil(gate.retryInMs / 60000);
    return { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  const code = String(formData.get("code") ?? "");
  const password = String(formData.get("password") ?? "");

  const affiliate = await affiliateStore.authenticate(code, password);
  if (!affiliate) {
    // One message for a wrong code, a wrong password and a deactivated
    // account. Telling them apart would let someone map which codes exist.
    return { error: "That referral code and password do not match." };
  }

  if (!(await startAffiliateSession(affiliate.code))) {
    return { error: "The affiliate portal is not configured on this environment." };
  }
  clearThrottle(key);
  redirect("/affiliate");
}

/**
 * Demo sign-in: takes a code and no password.
 *
 * Gated on the same flag that switches the admin sign-in off, and re-checked
 * here rather than trusted from the page that renders the buttons — a server
 * action is an endpoint and can be called directly, so a page-level check would
 * be no check at all.
 */
export async function affiliateDemoLogin(formData: FormData): Promise<void> {
  if (!adminAuthBypassed()) redirect("/affiliate/login");

  const code = normaliseCode(String(formData.get("code") ?? ""));
  if (!code) redirect("/affiliate/login");

  const affiliate = await affiliateStore.activeByCode(code);
  if (!affiliate) redirect("/affiliate/login");

  await startAffiliateSession(affiliate.code);
  redirect("/affiliate");
}

export async function affiliateLogout(): Promise<void> {
  await endAffiliateSession();
  redirect("/affiliate/login");
}
