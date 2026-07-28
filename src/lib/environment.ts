/**
 * Where this instance is running.
 *
 * Several safeguards need to distinguish "a developer's laptop" from "a
 * deployment customers can reach", because behaviour that is convenient in
 * development is dangerous in front of real buyers — simulated payments most of
 * all.
 */

/** True on any Vercel deployment, including previews. */
export const onVercel = () => process.env.VERCEL === "1";

/**
 * A deployment real customers can reach.
 *
 * `VERCEL_ENV` is the reliable signal on Vercel: `NODE_ENV` is "production"
 * for preview builds too, which would make previews indistinguishable from the
 * live shop.
 */
export function isProductionDeployment(): boolean {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";
  return process.env.NODE_ENV === "production";
}

/**
 * Escape hatch for showing the shop on a production URL without a payment
 * gateway. Must be set deliberately; the default is to refuse.
 */
export const simulatedPaymentsAllowed = () =>
  !isProductionDeployment() || process.env.ALLOW_SIMULATED_PAYMENTS === "1";

/**
 * Opens the admin area to anyone who knows the URL.
 *
 * For showing the system before credentials exist. It is off unless
 * `ADMIN_DEMO_MODE` is exactly "1", so it can only ever be turned on
 * deliberately — there is no combination of *missing* configuration that
 * produces it.
 *
 * It is honoured on production deployments too, because the demo has to be
 * viewable on the deployed URL to be useful. That makes it genuinely unsafe
 * once real orders exist: the admin area lists customers' names, phone numbers
 * and delivery addresses. Every admin page carries a banner while this is on,
 * so the state cannot be forgotten.
 *
 * `npm run demo` writes it to `.env.local`, which is gitignored and never
 * uploaded — a Vercel deployment keeps its sign-in unless someone adds the
 * variable to the project's environment on purpose.
 */
export const adminAuthBypassed = () => process.env.ADMIN_DEMO_MODE === "1";
