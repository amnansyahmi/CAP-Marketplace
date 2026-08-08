import { NextResponse } from "next/server";

import { agentConfig } from "@/lib/agent";
import { authenticatePartner } from "@/lib/partner/auth";
import { salesSummary } from "@/lib/partner/sales";

export const dynamic = "force-dynamic";

/**
 * GET /api/partner/summary
 *
 * Headline figures for a period, so the dashboard does not have to page the
 * whole sales feed to show totals. Counts settled orders only.
 *
 * Query: from, to (ISO dates)
 */
export async function GET(request: Request) {
  const auth = authenticatePartner(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  try {
    const summary = await salesSummary({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });

    const agent = agentConfig();
    return NextResponse.json(
      {
        period: {
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
        },
        currency: "MYR",
        // Echoed so the dashboard can show the terms its figures were produced
        // under, and notice if they change.
        agentTerms: agent.enabled
          ? { name: agent.name, feePerSale: agent.feePerSale, basis: agent.basis }
          : null,
        summary,
      },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read summary.";
    const clientError = /Invalid (from|to) date/.test(message);
    if (!clientError) console.error("Partner summary query failed", error);
    return NextResponse.json(
      { error: clientError ? message : "Could not read summary." },
      { status: clientError ? 400 : 500 },
    );
  }
}
