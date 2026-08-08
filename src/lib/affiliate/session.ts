import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AFFILIATE_COOKIE, affiliateAuthConfig, issueSession, readSession } from "@/lib/affiliate/auth";
import { affiliateStore, type Affiliate } from "@/lib/affiliates";

/**
 * The affiliate this request is signed in as, or undefined.
 *
 * Re-reads the affiliate on every request rather than trusting the cookie's
 * contents beyond the code. Deactivating someone has to take effect
 * immediately, not whenever their month-long session happens to expire.
 */
export async function currentAffiliate(): Promise<Affiliate | undefined> {
  const jar = await cookies();
  const code = readSession(jar.get(AFFILIATE_COOKIE)?.value);
  if (!code) return undefined;

  const affiliate = await affiliateStore.byCode(code);
  if (!affiliate || !affiliate.active) return undefined;
  return affiliate;
}

/**
 * Gate for portal pages and server actions.
 *
 * Returns the affiliate so callers scope their queries to it. Every query in
 * the portal takes its id from here and never from a URL or form field —
 * an affiliate must not be able to ask for someone else's sales by changing a
 * parameter.
 */
export async function requireAffiliate(): Promise<Affiliate> {
  const affiliate = await currentAffiliate();
  if (!affiliate) redirect("/affiliate/login");
  return affiliate;
}

export async function startAffiliateSession(code: string): Promise<boolean> {
  const session = issueSession(code);
  if (!session) return false;

  const jar = await cookies();
  jar.set(AFFILIATE_COOKIE, session.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });
  return true;
}

export async function endAffiliateSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(AFFILIATE_COOKIE);
}

export { affiliateAuthConfig };
