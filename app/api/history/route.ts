// app/api/history/route.ts
//
// Reads back saved trade scenarios from the database (see lib/db.ts).
// GET /api/history           -> most recent scenarios across all tickers
// GET /api/history?ticker=X  -> most recent scenarios for just ticker X

import { NextRequest, NextResponse } from "next/server";
import { listTradeScenarios } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get("ticker") ?? undefined;
    const scenarios = await listTradeScenarios(ticker);
    return NextResponse.json({ scenarios });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load history." },
      { status: 500 }
    );
  }
}
