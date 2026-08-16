/**
 * The shape every payment gateway is used through.
 *
 * The shop only ever needs two things from a gateway: somewhere to send the
 * customer to pay, and a trustworthy answer afterwards about whether the money
 * arrived. Everything else — line-item formats, checksum schemes, status codes —
 * belongs inside an adapter, so adding or swapping a provider never reaches
 * into stock, discounts, commission or fulfilment.
 *
 * Set `NEXT_PUBLIC_PAYMENT_GATEWAY` to `bayarcash` (default) or `chip`.
 */

import type { Order, OrderStatus } from "@/lib/orders";
import { simulatedPaymentsAllowed } from "@/lib/environment";
import { gatewayId, gatewayLabel, type GatewayId } from "@/lib/payments/label";

export type PurchaseResult = {
  paymentId: string;
  checkoutUrl: string;
  /** False when the payment was simulated because no gateway is configured. */
  live: boolean;
};

export type PurchaseUrls = {
  /**
   * The single URL the payer is handed back to, whatever the outcome. Gateways
   * that report the result in the redirect itself use this one.
   */
  returnUrl: string;
  /** Used instead by gateways that take a separate URL per outcome. */
  successUrl: string;
  failureUrl: string;
  /** Server-to-server notification. The only source the shop settles on. */
  callbackUrl: string;
};

/**
 * What a callback turned out to be.
 *
 * `ok: false` separates "this did not come from the gateway" from "this is
 * gibberish", because the two deserve different answers: one is a security
 * event, the other a bug or a truncated request.
 */
export type CallbackReading =
  | { ok: false; reason: "unverified" | "malformed" }
  | {
      ok: true;
      /** For logging and for acknowledging events we have no opinion about. */
      event: string;
      /** Absent when the event carries no status change (e.g. a pending notice). */
      status?: OrderStatus;
      /** Either identifier may be missing; the handler needs one of them. */
      paymentId?: string;
      reference?: string;
      /**
       * What was actually paid, when the gateway reports it.
       *
       * Checked against the order total before anything is settled: a verified
       * callback proves the gateway sent it, not that the right amount arrived.
       * Left undefined by gateways that do not report it, which skips the check
       * rather than failing every payment.
       */
      paidAmount?: number;
      paidCurrency?: string;
    };

export interface PaymentGateway {
  readonly id: GatewayId;
  readonly label: string;
  /** Where this gateway's server-to-server callback is delivered. */
  readonly callbackPath: string;
  /**
   * Where the payer's browser is sent back to, when the gateway needs its own
   * route to verify the redirect before showing the customer anything.
   */
  readonly returnPath?: string;
  /** The variables a deployment must set before real money can move. */
  readonly requiredEnv: readonly string[];
  /** True once configured to take real payments. */
  isLive(): boolean;
  createPurchase(order: Order, urls: PurchaseUrls): Promise<PurchaseResult>;
  /**
   * Verify and interpret a callback. Called with the *raw* body: re-serialising
   * parsed input changes the bytes and will fail an otherwise valid signature.
   */
  readCallback(rawBody: string, headers: Headers): CallbackReading;
}

/**
 * The stand-in used when no gateway is configured.
 *
 * Refusing on a production deployment is the whole point. Without this, going
 * live without credentials would hand real customers an order marked
 * "confirmed" for money that was never taken — a far worse failure than a
 * broken checkout.
 */
export function simulatedPurchase(order: Order, urls: PurchaseUrls, requiredEnv: readonly string[]): PurchaseResult {
  if (!simulatedPaymentsAllowed()) {
    throw new Error(
      "Refusing to simulate a payment on a production deployment. " +
        `Set ${requiredEnv.join(" and ")} to take real payments, or set ` +
        "ALLOW_SIMULATED_PAYMENTS=1 if this deployment is deliberately a demo.",
    );
  }
  return { paymentId: `sim_${order.id}`, checkoutUrl: urls.successUrl, live: false };
}

export { gatewayId, gatewayLabel };
export type { GatewayId };
