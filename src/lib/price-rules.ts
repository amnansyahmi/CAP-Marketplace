/**
 * What counts as a price, shared by the admin form and the server action.
 *
 * Kept apart from `src/lib/pricing.ts` because that module reaches the
 * database, and the form that uses these bounds runs in the browser — importing
 * it there would pull the Postgres driver into the bundle. The same split as
 * `src/lib/affiliate/password-rules.ts`.
 */

/**
 * The floor matches the payment gateway's own minimum, so a price it would
 * reject cannot be set here.
 */
export const MIN_PRICE = 1;

/**
 * The ceiling is not arithmetic — it is a fat finger. An extra zero on a jar of
 * spice paste is a mistake every time, and the shop would rather refuse it than
 * put RM 1,990 in front of a customer.
 */
export const MAX_PRICE = 999;

/** Why this is not a price, or null when it is one. */
export function priceProblem(value: number): string | null {
  if (!Number.isFinite(value)) return "Enter a price.";
  if (value < MIN_PRICE) return `A price must be at least RM ${MIN_PRICE.toFixed(2)}.`;
  if (value > MAX_PRICE) return `A price cannot be more than RM ${MAX_PRICE.toFixed(2)}.`;
  // Compared with a tolerance, not for equality: 19.99 * 100 is
  // 1998.9999999999998 in binary floating point, and an exact test would refuse
  // a perfectly ordinary price.
  const sen = value * 100;
  if (Math.abs(sen - Math.round(sen)) > 1e-6) return "A price can have at most two decimal places.";
  return null;
}
