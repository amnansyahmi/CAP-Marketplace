/**
 * Agent fee.
 *
 * KretivWork is the sole agent for the Chef Ammar range and earns a flat fee on
 * every sale. This is deliberately separate from the affiliate system:
 *
 *   Affiliate  — many, percentage of subtotal, only on orders they referred.
 *   Agent      — one, flat fee, on every order regardless of how it arrived.
 *
 * Both can apply to the same order; they are different arrangements, not
 * alternatives, and an order carrying both pays both.
 *
 * !! CHECK THE BASIS BEFORE GOING LIVE.
 * "RM 2 per sale" is ambiguous between per order and per jar. A four-jar order
 * pays RM 2.00 on the default `order` basis and RM 8.00 on the `unit` basis —
 * a fourfold difference in what the agent is owed. The default is `order`, the
 * more literal reading of "per sale"; set AGENT_FEE_BASIS=unit if the agreement
 * is actually per jar.
 */

import { round } from "@/lib/shipping";

export type AgentFeeBasis = "order" | "unit";
export type AgentFeeStatus = "none" | "pending" | "paid" | "void";

export type AgentConfig = {
  name: string;
  /** Ringgit per order, or per jar, depending on `basis`. */
  feePerSale: number;
  basis: AgentFeeBasis;
  enabled: boolean;
};

const DEFAULT_FEE = 2;

export function agentConfig(): AgentConfig {
  const name = process.env.AGENT_NAME?.trim() || "KretivWork";
  const raw = process.env.AGENT_FEE_PER_SALE;
  const parsed = raw === undefined ? DEFAULT_FEE : Number(raw);
  const feePerSale = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FEE;
  const basis: AgentFeeBasis = process.env.AGENT_FEE_BASIS === "unit" ? "unit" : "order";
  return { name, feePerSale, basis, enabled: feePerSale > 0 };
}

/**
 * Fee for one order.
 *
 * `units` is the total jar count, used only on the `unit` basis. Returns 0 when
 * the agent arrangement is switched off, so callers do not need to branch.
 */
export function agentFeeFor(units: number, config = agentConfig()): number {
  if (!config.enabled) return 0;
  const multiplier = config.basis === "unit" ? Math.max(0, Math.floor(units)) : 1;
  return round(config.feePerSale * multiplier);
}

export const totalUnits = (items: { quantity: number }[]) =>
  items.reduce((sum, i) => sum + i.quantity, 0);
