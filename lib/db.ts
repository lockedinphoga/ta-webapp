// lib/db.ts
//
// WHAT IS THIS FILE FOR? Handles saving and reading your trade-scenario
// history from a real database (Postgres, hosted via Vercel/Neon), so
// past analyses stick around across visits — even on different devices.
//
// WHY A DATABASE AT ALL? Your app's server code runs as "serverless
// functions" on Vercel: every request spins up a fresh, temporary
// instance that disappears right after responding. Nothing computed
// during one request is still around for the next one — there's no
// server "memory" to write JavaScript variables into and expect them to
// persist. A database is storage that lives OUTSIDE your app's code,
// so it's still there no matter how many times your serverless
// functions start and stop.
//
// WHAT IS "POSTGRES"? PostgreSQL (usually called just "Postgres") is one
// of the most widely used open-source relational databases — data is
// organized into tables with named columns (rows = individual records),
// and you read/write it using SQL (Structured Query Language), a
// standard query language most databases understand.
//
// HOW THIS CONNECTS: Vercel's Postgres storage (built on Neon) gives your
// deployed app a `DATABASE_URL` environment variable automatically once
// you create and link the database in the Vercel dashboard — no manual
// wiring needed there. For LOCAL development, you need that same
// connection string in your own .env.local (see .env.local.example);
// Vercel's dashboard has a "copy" button for it under Storage > your
// database > .env.local tab.

import { neon } from "@neondatabase/serverless";

// `neon(...)` returns a function you call like `sql\`SELECT ...\`` — a
// "tagged template" that safely inserts your variables into the query
// for you (this automatically protects against SQL injection, a common
// security bug where user input could otherwise be crafted to run
// unintended database commands — you don't have to think about it, just
// always pass values via ${...} inside the sql\`...\` template like below,
// never by manually gluing strings together).
function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL isn't set. Add it to your .env.local (see .env.local.example), or in Vercel's dashboard for the deployed app."
    );
  }
  return neon(connectionString);
}

export interface TradeScenarioRecord {
  id: number;
  ticker: string;
  createdAt: string;
  lastClose: number | null;
  bias: "long" | "short" | "neutral";
  confidence: "low" | "medium" | "high";
  reasoning: string;
  entryZone: string | null;
  stopLoss: number;
  stopLossReasoning: string;
  target: number;
  targetReasoning: string;
  holdingPeriodDays: number;
  holdingPeriodLabel: string;
  atr14: number | null;
  usedIndicators: string[]; // which indicator checkboxes were on for this analysis — i.e. "what signal indicated what"
}

// Creates the table the very first time it's needed. Safe to call on
// every request — "IF NOT EXISTS" means it's a no-op once the table
// already exists, so there's no separate manual "migration" step to run.
async function ensureTable() {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS trade_scenarios (
      id SERIAL PRIMARY KEY,
      ticker TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_close DOUBLE PRECISION,
      bias TEXT NOT NULL,
      confidence TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      entry_zone TEXT,
      stop_loss DOUBLE PRECISION NOT NULL,
      stop_loss_reasoning TEXT NOT NULL,
      target DOUBLE PRECISION NOT NULL,
      target_reasoning TEXT NOT NULL,
      holding_period_days INTEGER NOT NULL,
      holding_period_label TEXT NOT NULL,
      atr14 DOUBLE PRECISION,
      used_indicators JSONB NOT NULL
    )
  `;
}

// Saves one trade scenario. Called right after the AI generates one, from
// app/api/analyze/route.ts. This is "best-effort" — if it fails (e.g. you
// haven't set up DATABASE_URL yet), the caller catches the error and just
// skips saving, rather than failing the whole analysis request. Losing
// history is a much smaller problem than losing the ability to analyze a
// ticker at all.
export async function saveTradeScenario(record: {
  ticker: string;
  lastClose: number | null;
  bias: string;
  confidence: string;
  reasoning: string;
  entryZone?: string;
  stopLoss: number;
  stopLossReasoning: string;
  target: number;
  targetReasoning: string;
  holdingPeriodDays: number;
  holdingPeriodLabel: string;
  atr14: number | null;
  usedIndicators: string[];
}): Promise<void> {
  const sql = getSql();
  await ensureTable();
  await sql`
    INSERT INTO trade_scenarios (
      ticker, last_close, bias, confidence, reasoning, entry_zone,
      stop_loss, stop_loss_reasoning, target, target_reasoning,
      holding_period_days, holding_period_label, atr14, used_indicators
    ) VALUES (
      ${record.ticker}, ${record.lastClose}, ${record.bias}, ${record.confidence}, ${record.reasoning}, ${record.entryZone ?? null},
      ${record.stopLoss}, ${record.stopLossReasoning}, ${record.target}, ${record.targetReasoning},
      ${record.holdingPeriodDays}, ${record.holdingPeriodLabel}, ${record.atr14}, ${JSON.stringify(record.usedIndicators)}
    )
  `;
}

// Reads back saved scenarios, newest first. Optionally filtered to one
// ticker. Used by app/api/history/route.ts.
export async function listTradeScenarios(ticker?: string, limit = 50): Promise<TradeScenarioRecord[]> {
  const sql = getSql();
  await ensureTable();
  const rows = ticker
    ? await sql`SELECT * FROM trade_scenarios WHERE ticker = ${ticker.toUpperCase()} ORDER BY created_at DESC LIMIT ${limit}`
    : await sql`SELECT * FROM trade_scenarios ORDER BY created_at DESC LIMIT ${limit}`;

  return (rows as any[]).map((r) => ({
    id: r.id,
    ticker: r.ticker,
    createdAt: r.created_at,
    lastClose: r.last_close,
    bias: r.bias,
    confidence: r.confidence,
    reasoning: r.reasoning,
    entryZone: r.entry_zone,
    stopLoss: r.stop_loss,
    stopLossReasoning: r.stop_loss_reasoning,
    target: r.target,
    targetReasoning: r.target_reasoning,
    holdingPeriodDays: r.holding_period_days,
    holdingPeriodLabel: r.holding_period_label,
    atr14: r.atr14,
    usedIndicators: r.used_indicators,
  }));
}
