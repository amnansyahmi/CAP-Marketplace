/**
 * Which gateway adapter the shop is actually using.
 *
 * Kept apart from `gateway.ts` so the adapters can import the shared types
 * without importing the thing that imports them. Server-side only: both
 * adapters reach for `node:crypto`.
 */

import { bayarcashGateway } from "@/lib/payments/bayarcash";
import { chipGateway } from "@/lib/payments/chip";
import { gatewayId, type GatewayId } from "@/lib/payments/label";
import type { PaymentGateway } from "@/lib/payments/gateway";

const GATEWAYS: Record<GatewayId, PaymentGateway> = {
  bayarcash: bayarcashGateway,
  chip: chipGateway,
};

/**
 * Resolved on each call rather than frozen at import: tests and the `demo`
 * script set the environment after modules have loaded.
 */
export function activeGateway(): PaymentGateway {
  return GATEWAYS[gatewayId()];
}

/**
 * A specific gateway, whichever one is active.
 *
 * Callback routes use this: a gateway that has been switched away from may
 * still have payments in flight, and those callbacks must keep being honoured
 * rather than answered with the wrong verifier.
 */
export function gatewayFor(id: GatewayId): PaymentGateway {
  return GATEWAYS[id];
}
