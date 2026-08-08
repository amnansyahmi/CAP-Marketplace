"use server";

import { headers } from "next/headers";

import { rateLimit } from "@/lib/rate-limit";
import { subscribe } from "@/lib/subscribers";

/**
 * Records a newsletter sign-up.
 *
 * Throttled per client: the form is unauthenticated and writes a row, so
 * without a limit it is a way to fill a table with addresses nobody entered.
 *
 * Says the same thing whether the address was new or already on the list. "You
 * are already subscribed" quietly confirms to a stranger that an address is on
 * the shop's list, which is not theirs to learn.
 */
export async function subscribeToNewsletter(
  _prev: { ok?: string; error?: string } | undefined,
  formData: FormData,
): Promise<{ ok?: string; error?: string }> {
  const h = await headers();
  const key = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";

  const gate = rateLimit(`newsletter:${key}`, { limit: 5, windowMs: 10 * 60 * 1000 });
  if (!gate.allowed) return { error: "Too many attempts. Please try again shortly." };

  const result = await subscribe(String(formData.get("email") ?? ""), "footer");
  if (!result.ok) return { error: result.reason };

  return { ok: "You are on the list. We will be in touch when there is something worth sending." };
}
