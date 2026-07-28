import { NextResponse } from "next/server";

import { authenticatePartner } from "@/lib/partner/auth";
import { listSales } from "@/lib/partner/sales";
import type { OrderStatus } from "@/lib/orders";

export const dynamic = "force-dynamic";

const STATUSES: OrderStatus[] = ["pending_payment", "paid", "failed", "cancelled"];

/**
 * GET /api/partner/sales
 *
 * Read-only sales feed for the central dashboard. See README for the contract.
 *
 * Query: from, to (ISO dates), status, limit (1-200), cursor
 */
export async function GET(request: Request) {
  const auth = authenticatePartner(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status") ?? undefined;
  if (statusParam && !STATUSES.includes(statusParam as OrderStatus)) {
    return NextResponse.json(
      { error: `Unknown status. Expected one of: ${STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  const limitParam = url.searchParams.get("limit");
  if (limitParam && !/^\d+$/.test(limitParam)) {
    return NextResponse.json({ error: "limit must be a positive integer." }, { status: 400 });
  }

  try {
    const result = await listSales({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      status: statusParam as OrderStatus | undefined,
      limit: limitParam ? Number(limitParam) : undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });

    return NextResponse.json(result, {
      // Commercial data: never let a shared cache hold it.
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    // Bad dates and cursors are the caller's mistake, not a server fault.
    const message = error instanceof Error ? error.message : "Could not read sales.";
    const clientError = /Invalid (from|to) date|Invalid cursor/.test(message);
    if (!clientError) console.error("Partner sales query failed", error);
    return NextResponse.json(
      { error: clientError ? message : "Could not read sales." },
      { status: clientError ? 400 : 500 },
    );
  }
}
