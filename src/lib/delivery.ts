/**
 * What the customer is offered at checkout.
 *
 * Sits between EasyParcel and the shop so that **checkout never depends on a
 * courier API being up**. Live rates are better when available; when they are
 * not, the flat zone rate takes over and the customer sees a working shop
 * rather than an error. A postage quote is not worth losing a sale over.
 *
 * Two prices, deliberately kept apart:
 *
 * - `price` is what the customer is charged. Free-delivery promises are applied
 *   here, so a qualifying order shows RM 0.00.
 * - `cost` is what the shop expects to pay the courier. Free delivery does not
 *   make a parcel free — it makes the shop absorb it — and folding the two
 *   together would quietly hide that from the margin.
 */

import { rateCheck, type CourierRate, type Destination, type Parcel } from "@/lib/easyparcel";
import { parcelFor, type ParcelLine } from "@/lib/parcel";
import { quoteShipping, round, zoneForState, ZONE_RATES } from "@/lib/shipping";

/**
 * Quotes are not per-customer.
 *
 * Two people in the same postcode buying two jars get the same courier prices,
 * and at checkout the same person refetches on every address edit. Under load
 * that is thousands of identical calls to a third party who is rate-limiting
 * and billing us, all to learn what we learned a minute ago.
 */
const QUOTE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_QUOTES = 500;
const quoteCache = new Map<string, { rates: CourierRate[]; expiresAt: number }>();

/**
 * How many failures in a row before we stop asking.
 *
 * When EasyParcel is down, every checkout otherwise waits the full timeout to
 * be told what the shop already knew after the first one. Three strikes, then
 * flat rates for a minute — the customer sees a working checkout instead of a
 * five-second pause, and the shop stops hammering an API that is struggling.
 */
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60 * 1000;
let consecutiveFailures = 0;
let breakerOpenUntil = 0;

function quoteKey(destination: Destination, parcel: Parcel): string {
  return [
    destination.postcode,
    destination.state,
    destination.country ?? "MY",
    parcel.weightKg,
    parcel.widthCm,
    parcel.heightCm,
    parcel.lengthCm,
  ].join("|");
}

/**
 * Live rates, or an empty list when the courier cannot answer.
 *
 * Everything about *not* letting a third party stand between a customer and
 * their order lives here: the cache, the breaker, and swallowing the failure so
 * `deliveryOptions` falls back to the flat rate.
 */
async function cachedRates(destination: Destination, parcel: Parcel): Promise<CourierRate[]> {
  const key = quoteKey(destination, parcel);
  const now = Date.now();

  const hit = quoteCache.get(key);
  if (hit && hit.expiresAt > now) return hit.rates;

  // Breaker open: do not spend a customer's time finding out again.
  if (now < breakerOpenUntil) return [];

  try {
    const rates = await rateCheck(destination, parcel);
    consecutiveFailures = 0;
    if (quoteCache.size >= MAX_CACHED_QUOTES) sweepQuotes(now);
    quoteCache.set(key, { rates, expiresAt: now + QUOTE_TTL_MS });
    return rates;
  } catch (error) {
    consecutiveFailures += 1;
    if (consecutiveFailures >= BREAKER_THRESHOLD) {
      breakerOpenUntil = now + BREAKER_COOLDOWN_MS;
      consecutiveFailures = 0;
      console.warn(
        `EasyParcel unreachable ${BREAKER_THRESHOLD} times in a row — using flat rates for ${
          BREAKER_COOLDOWN_MS / 1000
        }s.`,
        error,
      );
    }
    // A stale quote still beats no quote when the alternative is the flat rate.
    if (hit) return hit.rates;
    return [];
  }
}

function sweepQuotes(now: number): void {
  for (const [key, entry] of quoteCache) {
    if (entry.expiresAt <= now) quoteCache.delete(key);
  }
  // Everything still live: drop the oldest rather than grow without bound.
  if (quoteCache.size >= MAX_CACHED_QUOTES) {
    const oldest = [...quoteCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [key] of oldest.slice(0, Math.floor(MAX_CACHED_QUOTES / 4))) quoteCache.delete(key);
  }
}

/** Test seam — clears the cache and closes the breaker between cases. */
export function resetDeliveryCacheForTests(): void {
  quoteCache.clear();
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
}

export type DeliveryOption = {
  /** Stable across a session so the checkout can keep a selection. */
  id: string;
  courierName: string;
  serviceName: string;
  /** What the customer pays, after any free-delivery promise. */
  price: number;
  /** What the shop expects to pay the courier. */
  cost: number;
  deliveryEstimate?: string;
  /** EasyParcel's service id, needed to book. Absent on the flat fallback. */
  serviceId?: string;
  /** True when the shop priced this itself rather than a courier quoting it. */
  fallback: boolean;
};

export type DeliveryQuote = {
  options: DeliveryOption[];
  /** Where the prices came from, so the UI can be honest about it. */
  source: "easyparcel" | "flat";
  /** Set when the customer's order qualified for free delivery. */
  free: boolean;
  /** How much more to spend to ship free, when that is still reachable. */
  amountToFree: number | null;
  zoneLabel: string;
};

/** The shop's own rate, always available, used whenever a courier is not. */
function flatOption(subtotal: number, state: string): DeliveryOption | null {
  const quote = quoteShipping(subtotal, state);
  if (!quote) return null;

  return {
    id: "flat",
    courierName: "Standard delivery",
    serviceName: quote.zoneLabel,
    price: quote.fee,
    // The shop's own flat rate is its best estimate of the real cost too.
    cost: ZONE_RATES[quote.zone].fee,
    deliveryEstimate: quote.zone === "east" ? "3 to 6 working days" : "2 to 4 working days",
    fallback: true,
  };
}

/**
 * Delivery options for a bag going to a destination.
 *
 * Never throws and never returns an empty list for a deliverable address.
 */
export async function deliveryOptions(
  lines: ParcelLine[],
  destination: Destination,
  subtotal: number,
): Promise<DeliveryQuote | null> {
  const quote = quoteShipping(subtotal, destination.state);
  // Not a state we deliver to. That is a real refusal, not a fallback.
  if (!quote) return null;

  const flat = flatOption(subtotal, destination.state);
  const base: Omit<DeliveryQuote, "options" | "source"> = {
    free: quote.free,
    amountToFree: quote.amountToFree,
    zoneLabel: quote.zoneLabel,
  };

  const rates = await cachedRates(destination, parcelFor(lines));

  if (rates.length === 0) {
    return { ...base, options: flat ? [applyFreeDelivery(flat, quote.free)] : [], source: "flat" };
  }

  const options = rates.map((rate) =>
    applyFreeDelivery(
      {
        id: rate.serviceId,
        courierName: rate.courierName,
        serviceName: rate.serviceName,
        price: rate.price,
        cost: rate.price,
        deliveryEstimate: rate.deliveryEstimate,
        serviceId: rate.serviceId,
        fallback: false,
      },
      quote.free,
    ),
  );

  return { ...base, options, source: "easyparcel" };
}

/** Free delivery zeroes what the customer pays, never what the courier charges. */
function applyFreeDelivery(option: DeliveryOption, free: boolean): DeliveryOption {
  return free ? { ...option, price: 0 } : option;
}

/**
 * Re-prices a chosen option server-side.
 *
 * The order API calls this instead of trusting the figure the browser posted,
 * for the same reason it rebuilds every line from the catalogue: a price that
 * arrives from a client is a suggestion, not a fact.
 *
 * Falls back to the flat rate when the chosen service has disappeared — a
 * courier can withdraw a service between quoting and paying, and the customer
 * should not be stranded on the payment page because of it.
 */
export async function priceDelivery(
  lines: ParcelLine[],
  destination: Destination,
  subtotal: number,
  chosenServiceId: string | undefined,
): Promise<DeliveryOption | null> {
  const quote = await deliveryOptions(lines, destination, subtotal);
  if (!quote || quote.options.length === 0) return null;

  const chosen = chosenServiceId
    ? quote.options.find((option) => option.id === chosenServiceId)
    : undefined;
  if (chosen) return chosen;

  // Nothing chosen, or the choice is gone: the cheapest is the safe default,
  // because it is the one the customer is least likely to object to paying.
  return quote.options.reduce((cheapest, option) => (option.price < cheapest.price ? option : cheapest));
}

/** Rounds a courier price the same way every other money figure is rounded. */
export const deliveryPrice = (value: number) => round(value);

export { zoneForState };
