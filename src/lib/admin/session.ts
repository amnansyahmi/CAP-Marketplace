import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_COOKIE, adminConfig, issueSession, verifySession } from "@/lib/admin/auth";
import { adminAuthBypassed } from "@/lib/environment";

/**
 * True when the current request may use the admin area.
 *
 * The single chokepoint: `requireAdmin`, the layout and every server action go
 * through here, so demo mode cannot open one route while leaving another shut.
 */
export async function isAdmin(): Promise<boolean> {
  if (adminAuthBypassed()) return true;
  const jar = await cookies();
  return verifySession(jar.get(ADMIN_COOKIE)?.value);
}

/**
 * Gate for admin pages and server actions.
 *
 * Called at the top of every server action as well as in the layout: layout
 * protection guards navigation, but a server action can be invoked directly,
 * so it must check for itself.
 */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

export async function startSession(): Promise<boolean> {
  const session = issueSession();
  if (!session) return false;

  const jar = await cookies();
  jar.set(ADMIN_COOKIE, session.value, {
    httpOnly: true, // not readable from JavaScript
    sameSite: "lax", // not sent on cross-site form posts
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });
  return true;
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
}

export { adminConfig };
