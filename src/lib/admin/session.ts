import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_COOKIE, adminConfig, issueSession, verifySession } from "@/lib/admin/auth";

/** True when the current request carries a valid admin session. */
export async function isAdmin(): Promise<boolean> {
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
