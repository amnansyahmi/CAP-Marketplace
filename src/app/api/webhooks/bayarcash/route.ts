import { gatewayFor } from "@/lib/payments/active";
import { handleGatewayCallback } from "@/lib/payments/callbacks";

export const dynamic = "force-dynamic";

/**
 * Bayarcash's server-to-server notification (`callback_url`).
 *
 * This is the only thing the shop settles an order on. The payer's redirect
 * back from the bank is handled separately, in
 * `/api/payments/bayarcash/return`, and only decides what the customer is
 * shown — a browser that never completes the redirect must not cost a
 * confirmed payment.
 */
export async function POST(request: Request) {
  return handleGatewayCallback(gatewayFor("bayarcash"), request);
}
