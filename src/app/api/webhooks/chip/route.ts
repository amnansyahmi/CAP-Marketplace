import { gatewayFor } from "@/lib/payments/active";
import { handleGatewayCallback } from "@/lib/payments/callbacks";

export const dynamic = "force-dynamic";

/**
 * Kept at its own path even when CHIP is not the active gateway: a shop that
 * has switched to another provider may still have CHIP payments in flight, and
 * dropping the route would strand them.
 */
export async function POST(request: Request) {
  return handleGatewayCallback(gatewayFor("chip"), request);
}
