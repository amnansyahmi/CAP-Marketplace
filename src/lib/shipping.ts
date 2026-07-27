/**
 * Delivery zones and rates for Malaysia.
 *
 * Shared by the checkout UI (to show a live quote) and by the order API (to
 * recompute the real charge), so the customer can never be billed a shipping
 * figure the server did not calculate itself.
 */

export type Zone = "west" | "east";

export const MALAYSIAN_STATES = [
  "Johor",
  "Kedah",
  "Kelantan",
  "Kuala Lumpur",
  "Labuan",
  "Melaka",
  "Negeri Sembilan",
  "Pahang",
  "Perak",
  "Perlis",
  "Pulau Pinang",
  "Putrajaya",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
] as const;

export type MalaysianState = (typeof MALAYSIAN_STATES)[number];

/** Sabah, Sarawak and Labuan ship at the East Malaysia rate. */
const EAST_STATES = new Set<string>(["Sabah", "Sarawak", "Labuan"]);

export const ZONE_RATES: Record<Zone, { label: string; fee: number; freeFrom: number }> = {
  west: { label: "Semenanjung Malaysia", fee: 8, freeFrom: 150 },
  east: { label: "Sabah, Sarawak & Labuan", fee: 18, freeFrom: 250 },
};

export function isMalaysianState(value: string): value is MalaysianState {
  return (MALAYSIAN_STATES as readonly string[]).includes(value);
}

export function zoneForState(state: string): Zone {
  return EAST_STATES.has(state) ? "east" : "west";
}

export type ShippingQuote = {
  zone: Zone;
  zoneLabel: string;
  fee: number;
  /** Set when the order qualified for free delivery. */
  free: boolean;
  /** How much more the customer would need to spend to ship free, else null. */
  amountToFree: number | null;
};

export function quoteShipping(subtotal: number, state: string | null): ShippingQuote | null {
  if (!state || !isMalaysianState(state)) return null;
  const zone = zoneForState(state);
  const { label, fee, freeFrom } = ZONE_RATES[zone];
  const free = subtotal >= freeFrom;
  return {
    zone,
    zoneLabel: label,
    fee: free ? 0 : fee,
    free,
    amountToFree: free ? null : round(freeFrom - subtotal),
  };
}

/** Money helper — keeps totals off binary-float drift before they hit an invoice. */
export function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Convert ringgit to sen, which is what payment gateways expect. */
export function toSen(amount: number) {
  return Math.round(amount * 100);
}
