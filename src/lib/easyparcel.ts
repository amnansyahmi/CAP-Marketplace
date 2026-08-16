/**
 * EasyParcel — courier rates, booking and tracking.
 *
 * EasyParcel is an aggregator: one account covers J&T, Poslaju, DHL, Ninja Van
 * and the rest, so the shop books through a single integration instead of
 * onboarding with each courier separately.
 *
 * ## The contract
 *
 * Actions are selected by a query parameter and the body is form-encoded, not
 * JSON. Shipments are always sent as an indexed array (`bulk[0][...]`) even
 * when there is only one, and every response carries `api_status`,
 * `error_code`, `error_remark` and a `result` array.
 *
 *   POST https://connect.easyparcel.my/?ac=EPRateCheckingBulk
 *   api=<key>&bulk[0][pick_code]=55100&bulk[0][weight]=0.4&...
 *
 * ## What is verified and what is not
 *
 * Rate checking is built against EasyParcel's published example and its field
 * names are known good. **Order submission and payment are built to the same
 * documented shape but have not been run against a live merchant account**, so
 * their field names need confirming with a real API key before the first real
 * parcel is booked. `simulated` is true on every response the shop produced
 * itself, and the admin says so rather than implying a courier was contacted.
 *
 * ## Money
 *
 * Booking a shipment spends EasyParcel credit. Nothing here books anything on
 * its own — `payOrder` is called once, behind a database claim, from the admin
 * action that the shop owner deliberately clicked.
 *
 * Environment:
 *   EASYPARCEL_API_KEY   – enables the integration; unset means flat rates only
 *   EASYPARCEL_DEMO      – "1" to talk to the sandbox host instead of live
 *   EASYPARCEL_PICKUP_*  – where parcels are collected from
 */

import { round } from "@/lib/shipping";

const LIVE_HOST = "https://connect.easyparcel.my";
const DEMO_HOST = "https://demo.connect.easyparcel.my";

export type EasyParcelConfig =
  | { enabled: true; apiKey: string; host: string; demo: boolean; pickup: PickupAddress }
  | { enabled: false; reason: string };

export type PickupAddress = {
  contactName: string;
  contactPhone: string;
  addressLine: string;
  postcode: string;
  city: string;
  state: string;
  country: string;
};

/** Where parcels are collected. Rates depend on it, so it is not optional. */
function pickupAddress(): PickupAddress | null {
  const postcode = process.env.EASYPARCEL_PICKUP_POSTCODE;
  const state = process.env.EASYPARCEL_PICKUP_STATE;
  if (!postcode || !state) return null;

  return {
    contactName: process.env.EASYPARCEL_PICKUP_NAME || "Chef Ammar",
    contactPhone: process.env.EASYPARCEL_PICKUP_PHONE || "",
    addressLine: process.env.EASYPARCEL_PICKUP_ADDRESS || "",
    postcode,
    city: process.env.EASYPARCEL_PICKUP_CITY || "",
    state,
    country: process.env.EASYPARCEL_PICKUP_COUNTRY || "MY",
  };
}

export function easyParcelConfig(): EasyParcelConfig {
  const apiKey = process.env.EASYPARCEL_API_KEY;
  if (!apiKey) return { enabled: false, reason: "EASYPARCEL_API_KEY is not set" };

  const pickup = pickupAddress();
  if (!pickup) {
    // Without a collection point every rate would be wrong, which is worse
    // than having no live rates at all.
    return {
      enabled: false,
      reason: "EASYPARCEL_PICKUP_POSTCODE and EASYPARCEL_PICKUP_STATE are not set",
    };
  }

  const demo = process.env.EASYPARCEL_DEMO === "1";
  return { enabled: true, apiKey, host: demo ? DEMO_HOST : LIVE_HOST, demo, pickup };
}

export type CourierRate = {
  /** EasyParcel's id for the service, sent back when booking. */
  serviceId: string;
  courierName: string;
  serviceName: string;
  /** What the shop pays EasyParcel, in ringgit. */
  price: number;
  /** Delivery estimate as the courier words it, e.g. "2 to 4 working days". */
  deliveryEstimate?: string;
  /** True when this came from the shop's own fallback, not a courier. */
  simulated: boolean;
};

export type Parcel = {
  /** Kilograms. Couriers price on this, so it must be the packed weight. */
  weightKg: number;
  widthCm: number;
  lengthCm: number;
  heightCm: number;
};

export type Destination = { postcode: string; state: string; country?: string };

type ApiResponse<T> = {
  api_status?: string;
  error_code?: string | number;
  error_remark?: string;
  result?: T[];
};

/** EasyParcel signals success as `api_status: "Success"` with `error_code: "0"`. */
function ok(body: ApiResponse<unknown>): boolean {
  return String(body.api_status ?? "").toLowerCase() === "success" && String(body.error_code ?? "0") === "0";
}

/**
 * One form-encoded call.
 *
 * Never throws: every caller is on a path where a courier being unreachable
 * must degrade to a fallback rather than fail a customer's checkout.
 */
async function call<T>(
  action: string,
  fields: Record<string, string>,
  timeoutMs = 12_000,
): Promise<{ ok: true; result: T[] } | { ok: false; error: string }> {
  const config = easyParcelConfig();
  if (!config.enabled) return { ok: false, error: config.reason };

  const body = new URLSearchParams({ api: config.apiKey, ...fields });

  try {
    const response = await fetch(`${config.host}/?ac=${action}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      // A slow courier API must not hold a checkout open indefinitely.
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };

    const json = (await response.json()) as ApiResponse<T>;
    if (!ok(json)) {
      return { ok: false, error: json.error_remark || `EasyParcel error ${json.error_code}` };
    }
    return { ok: true, result: json.result ?? [] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Flattens one shipment into the `bulk[0][...]` fields the API expects. */
function shipmentFields(destination: Destination, parcel: Parcel, config: Extract<EasyParcelConfig, { enabled: true }>) {
  return {
    "bulk[0][pick_code]": config.pickup.postcode,
    "bulk[0][pick_state]": config.pickup.state,
    "bulk[0][pick_country]": config.pickup.country,
    "bulk[0][send_code]": destination.postcode,
    "bulk[0][send_state]": destination.state,
    "bulk[0][send_country]": destination.country ?? "MY",
    "bulk[0][weight]": String(parcel.weightKg),
    "bulk[0][width]": String(parcel.widthCm),
    "bulk[0][length]": String(parcel.lengthCm),
    "bulk[0][height]": String(parcel.heightCm),
  };
}

type RateRow = {
  service_id?: string;
  service_name?: string;
  courier_name?: string;
  price?: string | number;
  delivery?: string;
};

/**
 * Courier options for a destination, cheapest first.
 *
 * Returns an empty list rather than an error when EasyParcel is unreachable;
 * the caller falls back to the shop's own flat rate so checkout keeps working.
 */
/**
 * A courier quote that did not come back.
 *
 * Distinct from "this destination has no services", which is a real answer and
 * an empty list.
 */
export class RateCheckError extends Error {
  constructor(reason: string) {
    super(`EasyParcel rate check failed: ${reason}`);
    this.name = "RateCheckError";
  }
}

/**
 * Shorter than the booking timeout on purpose. A booking happens once, in the
 * admin, with someone watching; a rate check happens on the path of every
 * customer editing their address, and 12 seconds of it is 12 seconds of held
 * request per customer during an outage.
 */
const RATE_TIMEOUT_MS = 5_000;

export async function rateCheck(destination: Destination, parcel: Parcel): Promise<CourierRate[]> {
  const config = easyParcelConfig();
  if (!config.enabled) return [];

  const response = await call<{ rates?: RateRow[] } & RateRow>(
    "EPRateCheckingBulk",
    shipmentFields(destination, parcel, config),
    RATE_TIMEOUT_MS,
  );
  if (!response.ok) {
    console.warn(`EasyParcel rate check failed: ${response.error}`);
    // Thrown rather than returned as "no rates": a customer waiting at checkout
    // needs the flat rate immediately, and the caller has to be able to tell an
    // outage from a destination no courier serves. It decides what to do.
    throw new RateCheckError(response.error);
  }

  // The rates for a shipment come back nested under the bulk entry.
  const rows: RateRow[] = [];
  for (const entry of response.result) {
    if (Array.isArray(entry.rates)) rows.push(...entry.rates);
    else if (entry.service_id) rows.push(entry);
  }

  return rows
    .filter((row) => row.service_id && row.price != null)
    .map((row) => ({
      serviceId: String(row.service_id),
      courierName: row.courier_name?.trim() || "Courier",
      serviceName: row.service_name?.trim() || "Standard",
      price: round(Number(row.price)),
      deliveryEstimate: row.delivery?.trim() || undefined,
      simulated: false,
    }))
    .filter((rate) => Number.isFinite(rate.price) && rate.price >= 0)
    .sort((a, b) => a.price - b.price);
}

export type BookingRequest = {
  serviceId: string;
  reference: string;
  destination: Destination & {
    contactName: string;
    contactPhone: string;
    contactEmail: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
  };
  parcel: Parcel;
  /** What is in the box, for the consignment note. */
  contents: string;
  declaredValue: number;
};

export type Booking = {
  /** EasyParcel's own order number. */
  orderNumber: string;
  /** The courier's consignment number — what the customer tracks with. */
  consignmentNumber?: string;
  /** Link to the printable consignment note. */
  awbUrl?: string;
  courierName?: string;
  /** What the booking cost in EasyParcel credit. */
  price?: number;
  simulated: boolean;
};

type OrderRow = {
  order_number?: string;
  orderno?: string;
  parcel_number?: string;
  awb?: string;
  awb_id_link?: string;
  tracking_url?: string;
  courier?: string;
  price?: string | number;
  status?: string;
  remarks?: string;
};

/**
 * Books a shipment and pays for it.
 *
 * Two calls, because EasyParcel separates creating an order from paying for
 * it: the first reserves a booking, the second spends credit and returns the
 * consignment number. Split that way deliberately — if payment fails the
 * booking exists and can be retried without creating a duplicate parcel.
 *
 * **Field names below follow the documented shape but have not been confirmed
 * against a live account.** Verify before the first real parcel.
 */
export async function bookShipment(
  request: BookingRequest,
): Promise<{ ok: true; booking: Booking } | { ok: false; error: string }> {
  const config = easyParcelConfig();
  if (!config.enabled) return { ok: false, error: config.reason };

  const submit = await call<OrderRow>("EPSubmitOrderBulk", {
    ...shipmentFields(request.destination, request.parcel, config),
    "bulk[0][service_id]": request.serviceId,
    "bulk[0][reference]": request.reference,
    "bulk[0][content]": request.contents,
    "bulk[0][value]": String(request.declaredValue),

    "bulk[0][pick_name]": config.pickup.contactName,
    "bulk[0][pick_contact]": config.pickup.contactPhone,
    "bulk[0][pick_addr1]": config.pickup.addressLine,
    "bulk[0][pick_city]": config.pickup.city,

    "bulk[0][send_name]": request.destination.contactName,
    "bulk[0][send_contact]": request.destination.contactPhone,
    "bulk[0][send_email]": request.destination.contactEmail,
    "bulk[0][send_addr1]": request.destination.addressLine1,
    ...(request.destination.addressLine2
      ? { "bulk[0][send_addr2]": request.destination.addressLine2 }
      : {}),
    "bulk[0][send_city]": request.destination.city,
  });

  if (!submit.ok) return { ok: false, error: submit.error };

  const created = submit.result[0];
  const orderNumber = created?.order_number || created?.orderno;
  if (!orderNumber) return { ok: false, error: "EasyParcel accepted the order but returned no order number." };

  // Paying is what actually spends credit and produces a consignment note.
  const paid = await call<OrderRow>("EPPayOrderBulk", { "bulk[0][order_no]": orderNumber });
  if (!paid.ok) {
    // The booking exists but is unpaid. Surfacing the order number matters —
    // it is how the shop owner finds and settles it in the EasyParcel
    // dashboard instead of booking a second parcel.
    return { ok: false, error: `Booked as ${orderNumber} but payment failed: ${paid.error}` };
  }

  const settled = paid.result[0] ?? {};
  return {
    ok: true,
    booking: {
      orderNumber,
      consignmentNumber: settled.parcel_number || settled.awb || undefined,
      awbUrl: settled.awb_id_link || settled.tracking_url || undefined,
      courierName: settled.courier || created?.courier || undefined,
      price: settled.price != null ? round(Number(settled.price)) : undefined,
      simulated: false,
    },
  };
}

export type ParcelStatus = {
  consignmentNumber: string;
  /** The courier's own wording. */
  status: string;
  updatedAt?: string;
  /** Mapped onto the shop's fulfilment steps; null when it does not map. */
  fulfilment: "shipped" | "delivered" | null;
};

type StatusRow = {
  parcel_number?: string;
  awb?: string;
  status?: string;
  parcel_status?: string;
  updated_at?: string;
  latest_update?: string;
};

/**
 * Maps a courier's status wording onto the shop's fulfilment steps.
 *
 * Deliberately conservative: only "delivered" and clear in-transit wording
 * move anything. Anything unrecognised returns null and leaves fulfilment
 * where the shop owner put it, because guessing wrong would email a customer
 * that their parcel arrived when it has not.
 */
export function mapParcelStatus(raw: string): "shipped" | "delivered" | null {
  const status = raw.trim().toLowerCase();
  if (!status) return null;
  if (/deliver(ed|y successful)|completed|received by/.test(status)) return "delivered";
  if (/in.?transit|out for delivery|picked up|collected|shipped|on the way|departed|arrived at/.test(status)) {
    return "shipped";
  }
  return null;
}

export async function parcelStatus(
  consignmentNumbers: string[],
): Promise<{ ok: true; statuses: ParcelStatus[] } | { ok: false; error: string }> {
  const config = easyParcelConfig();
  if (!config.enabled) return { ok: false, error: config.reason };
  if (consignmentNumbers.length === 0) return { ok: true, statuses: [] };

  const fields: Record<string, string> = {};
  consignmentNumbers.forEach((number, i) => {
    fields[`bulk[${i}][awb_no]`] = number;
  });

  const response = await call<StatusRow>("EPParcelStatusBulk", fields);
  if (!response.ok) return { ok: false, error: response.error };

  return {
    ok: true,
    statuses: response.result
      .map((row) => {
        const consignmentNumber = row.parcel_number || row.awb || "";
        const status = row.parcel_status || row.status || "";
        return {
          consignmentNumber,
          status,
          updatedAt: row.updated_at || row.latest_update || undefined,
          fulfilment: mapParcelStatus(status),
        };
      })
      .filter((entry) => entry.consignmentNumber),
  };
}
