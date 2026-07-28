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
