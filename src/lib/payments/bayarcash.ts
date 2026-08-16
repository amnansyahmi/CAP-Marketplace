/**
 * Bayarcash integration (https://bayarcash.com/), API v3.
 *
 * Everything that touches Bayarcash's wire format lives in this file, so a
 * change at their end means editing one module.
 *
 * The shape follows the official PHP SDK (`bayarcash/php-sdk`): a payment
 * intent is posted form-encoded to `/payment-intents` with a bearer token, and
 * both the request and every callback carry an HMAC-SHA256 checksum computed
 * over a fixed set of fields, sorted by field name and joined with `|`.
 *
 * Required environment variables:
 *   BAYARCASH_PAT            – Personal Access Token from the Bayarcash console
 *   BAYARCASH_PORTAL_KEY     – the portal money is collected into
 *   BAYARCASH_API_SECRET_KEY – signs requests and verifies callbacks
 *
 * Optional:
 *   BAYARCASH_SANDBOX=1        – use the sandbox console instead of production
 *   BAYARCASH_PAYMENT_CHANNEL  – channel id, or a comma-separated list. Left
 *                                unset, the payer chooses on Bayarcash's page.
 *   BAYARCASH_API_URL          – full base URL override
 *
 * With no credentials the module runs in simulation mode: orders are created
 * and the customer is routed straight to the confirmation page. That keeps the
 * shop runnable in development and is refused outright on a production
 * deployment — see `simulatedPurchase`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Order, OrderStatus } from "@/lib/orders";
import {
  simulatedPurchase,
  type CallbackReading,
  type PaymentGateway,
  type PurchaseResult,
  type PurchaseUrls,
} from "@/lib/payments/gateway";

const PRODUCTION_API = "https://api.console.bayar.cash/v3";
const SANDBOX_API = "https://api.console.bayarcash-sandbox.com/v3";

/** Bayarcash channel ids, for `BAYARCASH_PAYMENT_CHANNEL`. */
export const PAYMENT_CHANNELS = {
  fpx: 1,
  manualTransfer: 2,
  fpxDirectDebit: 3,
  fpxLineOfCredit: 4,
  duitnowDobw: 5,
  duitnowQr: 6,
  spayLater: 7,
  boostPayflex: 8,
  qrisOnlineBanking: 9,
  qrisWallet: 10,
  nets: 11,
  creditCard: 12,
  alipay: 13,
  wechatPay: 14,
  promptPay: 15,
  touchNGo: 16,
  boostWallet: 17,
  grabPay: 18,
  grabPayLater: 19,
  shopeePay: 21,
} as const;

/**
 * Bayarcash reports outcomes as integers, not event names.
 *
 * 0 (new) and 1 (pending) are deliberately absent: they say the payment is
 * still in flight, and the order is already `pending_payment`. Mapping them to
 * anything would either be a no-op write or a lie.
 */
const STATUS_BY_CODE: Record<string, OrderStatus> = {
  "2": "failed",
  "3": "paid",
  "4": "cancelled",
};

const REQUIRED_ENV = ["BAYARCASH_PAT", "BAYARCASH_PORTAL_KEY"] as const;

export function bayarcashConfig() {
  const token = process.env.BAYARCASH_PAT;
  const portalKey = process.env.BAYARCASH_PORTAL_KEY;
  const secretKey = process.env.BAYARCASH_API_SECRET_KEY;
  const sandbox = process.env.BAYARCASH_SANDBOX === "1";
  const apiUrl = (process.env.BAYARCASH_API_URL ?? (sandbox ? SANDBOX_API : PRODUCTION_API)).replace(/\/$/, "");
  return { token, portalKey, secretKey, sandbox, apiUrl, isLive: Boolean(token && portalKey) };
}

/**
 * The checksum Bayarcash expects.
 *
 * Sorted by field name and joined with `|`, mirroring the SDK's
 * `ksort($payload); implode('|', $payload)`. The sort is what makes the scheme
 * order-independent, so callers can list fields in whatever order reads best.
 */
export function bayarcashChecksum(secretKey: string, fields: Record<string, string>): string {
  const payload = Object.keys(fields)
    .sort()
    .map((key) => fields[key])
    .join("|");
  return createHmac("sha256", secretKey).update(payload, "utf8").digest("hex");
}

function checksumMatches(expected: string, provided: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(provided, "utf8");
  if (left.length !== right.length) {
    // Compare against itself anyway so a wrong length is not distinguishable
    // by timing from a wrong digest.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * The five fields a payment intent is signed over.
 *
 * `payment_channel` is first in the SDK's array and empty when the payer is
 * left to choose — an empty string still takes its place in the joined payload,
 * so it is included unconditionally rather than dropped.
 */
function intentChecksumFields(data: {
  payment_channel: string;
  order_number: string;
  amount: string;
  payer_name: string;
  payer_email: string;
}) {
  return {
    payment_channel: data.payment_channel,
    order_number: data.order_number,
    amount: data.amount,
    payer_name: data.payer_name,
    payer_email: data.payer_email,
  };
}

/** Every field the server-to-server transaction callback is signed over. */
function transactionChecksumFields(data: Record<string, string>) {
  return {
    record_type: data.record_type ?? "",
    transaction_id: data.transaction_id ?? "",
    exchange_reference_number: data.exchange_reference_number ?? "",
    exchange_transaction_id: data.exchange_transaction_id ?? "",
    order_number: data.order_number ?? "",
    currency: data.currency ?? "",
    amount: data.amount ?? "",
    payer_name: data.payer_name ?? "",
    payer_email: data.payer_email ?? "",
    payer_bank_name: data.payer_bank_name ?? "",
    status: data.status ?? "",
    status_description: data.status_description ?? "",
    datetime: data.datetime ?? "",
  };
}

/** The shorter set used for the payer's redirect back to the shop. */
function returnChecksumFields(data: Record<string, string>) {
  return {
    transaction_id: data.transaction_id ?? "",
    exchange_reference_number: data.exchange_reference_number ?? "",
    exchange_transaction_id: data.exchange_transaction_id ?? "",
    order_number: data.order_number ?? "",
    currency: data.currency ?? "",
    amount: data.amount ?? "",
    payer_bank_name: data.payer_bank_name ?? "",
    status: data.status ?? "",
    status_description: data.status_description ?? "",
  };
}

/**
 * Sent before the transaction record exists, so it carries almost nothing.
 * Recognised only so an authentic notice can be acknowledged rather than
 * answered with a 401 that Bayarcash would keep retrying.
 */
function preTransactionChecksumFields(data: Record<string, string>) {
  return {
    record_type: data.record_type ?? "",
    exchange_reference_number: data.exchange_reference_number ?? "",
    order_number: data.order_number ?? "",
  };
}

/**
 * Malaysian mobile number in the form Bayarcash documents (60123456789).
 *
 * Customers type these with dashes, spaces and a leading zero. The e-wallet and
 * DuitNow channels reject anything else, and a rejection here costs a sale.
 */
export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  const national = digits.startsWith("60") ? digits : `60${digits.replace(/^0+/, "")}`;
  return national.slice(0, 20);
}

/** Bayarcash takes one amount as a decimal string, not a basket in sen. */
export function formatAmount(total: number): string {
  return total.toFixed(2);
}

export async function createPurchase(order: Order, urls: PurchaseUrls): Promise<PurchaseResult> {
  const { token, portalKey, secretKey, apiUrl, isLive } = bayarcashConfig();

  if (!isLive) return simulatedPurchase(order, urls, REQUIRED_ENV);

  const amount = formatAmount(order.total);
  // Caught here rather than as an opaque 422 from the gateway: the customer is
  // mid-checkout and the message has to mean something to whoever reads the log.
  if (order.total < 1) {
    throw new Error(`Bayarcash will not accept an amount below RM 1.00 (order ${order.reference} is ${amount}).`);
  }

  const channel = process.env.BAYARCASH_PAYMENT_CHANNEL?.trim() ?? "";
  const signed = intentChecksumFields({
    payment_channel: channel,
    order_number: order.reference,
    amount,
    // The gateway's own limits, applied here so a long name is trimmed rather
    // than bouncing the whole payment.
    payer_name: order.customer.fullName.slice(0, 150),
    payer_email: order.customer.email.slice(0, 250),
  });

  const body: Record<string, string> = {
    portal_key: portalKey!,
    ...signed,
    payer_telephone_number: normalisePhone(order.customer.phone),
    return_url: urls.returnUrl,
    callback_url: urls.callbackUrl,
  };
  // Omitted rather than sent empty: an empty channel is a valid *checksum*
  // input but not a valid request field.
  if (!channel) delete body.payment_channel;
  if (!body.payer_telephone_number) delete body.payer_telephone_number;

  // Recommended, not required — but an unsigned request is one a tampered
  // amount would sail straight through, so it is sent whenever a key exists.
  if (secretKey) body.checksum = bayarcashChecksum(secretKey, signed);

  const response = await fetch(`${apiUrl}/payment-intents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      // Form-encoded, matching the official SDK's `form_params`.
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Bayarcash payment intent failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const payload = (await response.json()) as { id?: string; url?: string; data?: { id?: string; url?: string } };
  const intent = payload.data ?? payload;
  if (!intent.id || !intent.url) {
    throw new Error("Bayarcash payment intent response missing id or url");
  }

  return { paymentId: intent.id, checkoutUrl: intent.url, live: true };
}

/**
 * Parse a callback body.
 *
 * The transaction callback arrives form-encoded; JSON is accepted too so a
 * console configured to send it does not fail silently.
 */
export function parseCallbackBody(rawBody: string, headers?: Headers): Record<string, string> | null {
  const contentType = headers?.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") return null;
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, v == null ? "" : String(v)]));
    } catch {
      return null;
    }
  }
  if (!rawBody.trim()) return null;
  return Object.fromEntries(new URLSearchParams(rawBody));
}

/**
 * Verify a callback came from Bayarcash.
 *
 * `variant` picks the field set: the server-to-server callback signs thirteen
 * fields, the payer's redirect nine, and a pre-transaction notice three. A
 * checksum only proves authenticity for the set it was computed over, so the
 * caller must say which one it is reading.
 */
export function verifyCallback(
  data: Record<string, string>,
  variant: "transaction" | "return" | "pre-transaction",
): boolean {
  const { secretKey } = bayarcashConfig();
  // No key means no way to tell an authentic callback from a forged one, and
  // the safe answer to that is "no" — never "assume it is fine".
  if (!secretKey) return false;

  const provided = data.checksum ?? "";
  if (!provided) return false;

  const fields =
    variant === "transaction"
      ? transactionChecksumFields(data)
      : variant === "return"
        ? returnChecksumFields(data)
        : preTransactionChecksumFields(data);

  return checksumMatches(bayarcashChecksum(secretKey, fields), provided);
}

/** Maps a Bayarcash status code onto an order status, or undefined while in flight. */
export function statusFromCode(code: string | undefined): OrderStatus | undefined {
  return STATUS_BY_CODE[String(code ?? "").trim()];
}

function readCallback(rawBody: string, headers: Headers): CallbackReading {
  const data = parseCallbackBody(rawBody, headers);
  if (!data) return { ok: false, reason: "malformed" };

  if (!verifyCallback(data, "transaction")) {
    // An authentic pre-transaction notice signs a different set of fields, so a
    // failure above is not yet proof of forgery.
    if (verifyCallback(data, "pre-transaction")) {
      return { ok: true, event: "pre-transaction", reference: data.order_number || undefined };
    }
    return { ok: false, reason: "unverified" };
  }

  const status = statusFromCode(data.status);
  // Reported so the handler can check it against the order total. Parsed
  // leniently: a value we cannot read becomes undefined, and an unreadable
  // amount must not be mistaken for a matching one.
  const paid = Number(data.amount);

  return {
    ok: true,
    event: `status:${data.status ?? ""}`,
    ...(status ? { status } : {}),
    // The callback names our order, not the payment intent, so the reference is
    // what the handler looks the order up by.
    reference: data.order_number || undefined,
    ...(Number.isFinite(paid) && data.amount ? { paidAmount: paid } : {}),
    ...(data.currency ? { paidCurrency: data.currency } : {}),
  };
}

export const bayarcashGateway: PaymentGateway = {
  id: "bayarcash",
  label: "Bayarcash",
  callbackPath: "/api/webhooks/bayarcash",
  returnPath: "/api/payments/bayarcash/return",
  requiredEnv: REQUIRED_ENV,
  isLive: () => bayarcashConfig().isLive,
  createPurchase,
  readCallback,
};
