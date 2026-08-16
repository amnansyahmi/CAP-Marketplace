/**
 * Which gateway this deployment uses, and what to call it on screen.
 *
 * Deliberately free of Node imports so client components can name the gateway
 * on a button without pulling the server-side integration into the browser
 * bundle. The selection lives in a `NEXT_PUBLIC_` variable for the same reason:
 * one variable read by both halves cannot drift out of step, and the name of a
 * payment provider is not a secret.
 */

export const GATEWAY_LABELS = {
  bayarcash: "Bayarcash",
  chip: "CHIP",
} as const;

export type GatewayId = keyof typeof GATEWAY_LABELS;

export const DEFAULT_GATEWAY: GatewayId = "bayarcash";

/**
 * An unrecognised value falls back to the default rather than throwing: a typo
 * in an environment variable must not take the whole shop down, and the
 * fallback is still a gateway that refuses to invent payments.
 */
export function gatewayId(): GatewayId {
  const configured = process.env.NEXT_PUBLIC_PAYMENT_GATEWAY?.trim().toLowerCase();
  return configured && configured in GATEWAY_LABELS ? (configured as GatewayId) : DEFAULT_GATEWAY;
}

export function gatewayLabel(): string {
  return GATEWAY_LABELS[gatewayId()];
}
