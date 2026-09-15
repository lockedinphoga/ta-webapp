// lib/db.ts
//
// WHAT IS THIS FILE FOR? Handles saving and reading your trade-scenario
// history from a real database (Postgres, hosted via Vercel's Storage
// tab), so past analyses stick around across visits — even on different
// devices.
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
// HOW THIS CONNECTS: when you create a database under your Vercel
// project's Storage tab, Vercel gives you a `POSTGRES_URL` environment
// variable (a connection string — basically an address + password
// combined into one string) automatically for the deployed app. For
// LOCAL development, you need that same value in your own .env.local
// (see .env.local.example) — copy it from that database's ".env.local"
// tab in the Vercel dashboard.
//
// WHY "pg" AND NOT A FANCIER LIBRARY? `pg` (short for "node-postgres")
// is the standard, most widely used way to talk to Postgres from
// Node.js — it works with ANY Postgres database (Vercel's, a different
// host, your own laptop), not tied to one specific provider. That
// portability is worth more here than a provider-specific convenience
// library, especially since Vercel has changed which database product
// it offers by default before.

import { Pool } from "pg";

// A "connection pool" reuses a small number of open connections instead
// of opening a brand new one for every single query — opening a
// connection is relatively slow, so reusing them keeps things fast.
// Stashing it on `globalThis` (see the comment in lib/renderChart.ts for
// the same pattern) means Next.js's dev-server hot-reloads don't create
// a new pool — and leak connections — every time you save a file.
const globalForDb = globalThis as unknown as { __taPgPool?: Pool };

function getPool(): Pool {
  if (globalForDb.__taPgPool) return globalForDb.__taPgPool;

  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error(
      "POSTGRES_URL isn't set. Add it to your .env.local (copy it from your database's \".env.local\" tab in Vercel's Storage dashboard), or make sure it's connected in Vercel's project settings for the deployed app."
    );
  }

  // TEMPORARY DEBUG LOG — safe to leave in briefly, but not something to
  // keep long-term once the bug is found. This prints the connection
  // string's STRUCTURE (which host/port it thinks it should connect to,
  // and the overall length) to Vercel's function logs, without ever
  // printing the password itself. This lets us see what Vercel is
  // actually handing the app at runtime, instead of guessing.
  try {
    const masked = connectionString.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
    console.log("[lib/db.ts] POSTGRES_URL length:", connectionString.length);
    console.log("[lib/db.ts] POSTGRES_URL (password masked):", masked);
    const parsed = new URL(connectionString);
    console.log("[lib/db.ts] Parsed hostname:", parsed.hostname, "| port:", parsed.port);
  } catch (parseErr) {
    console.log("[lib/db.ts] Failed to parse POSTGRES_URL as a URL at all:", parseErr);
  }

  const pool = new Pool({
    connectionString,
    // Vercel's Postgres (and most hosted Postgres providers) require an
    // encrypted connection. `rejectUnauthorized: false` skips verifying
    // the server's certificate against a known certificate authority —
    // not ideal for a bank, perfectly fine for a personal project talking
    // to a provider you already trust by using their connection string.
    ssl: { rejectUnauthorized: false },
  });
  globalForDb.__taPgPool = pool;
  return pool;
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
  const pool = getPool();
  await pool.query(`
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
  `);
}

// Saves one trade scenario. Called right after the AI generates one, from
// app/api/analyze/route.ts. This is "best-effort" — if it fails (e.g. you
// haven't set up POSTGRES_URL yet), the caller catches the error and just
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
  const pool = getPool();
  await ensureTable();
  // `pg` uses $1, $2, ... placeholders (instead of a tagged template) —
  // it fills them in safely for you, which is what protects against SQL
  // injection (a security bug where user input could otherwise be
  // crafted to run unintended database commands). Never build a SQL
  // string by gluing values in directly — always go through placeholders
  // like this.
  await pool.query(
    `INSERT INTO trade_scenarios (
      ticker, last_close, bias, confidence, reasoning, entry_zone,
      stop_loss, stop_loss_reasoning, target, target_reasoning,
      holding_period_days, holding_period_label, atr14, used_indicators
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      record.ticker,
      record.lastClose,
      record.bias,
      record.confidence,
      record.reasoning,
      record.entryZone ?? null,
      record.stopLoss,
      record.stopLossReasoning,
      record.target,
      record.targetReasoning,
      record.holdingPeriodDays,
      record.holdingPeriodLabel,
      record.atr14,
      JSON.stringify(record.usedIndicators),
    ]
  );
}

// Reads back saved scenarios, newest first. Optionally filtered to one
// ticker. Used by app/api/history/route.ts.
export async function listTradeScenarios(ticker?: string, limit = 50): Promise<TradeScenarioRecord[]> {
  const pool = getPool();
  await ensureTable();
  const result = ticker
    ? await pool.query(
        `SELECT * FROM trade_scenarios WHERE ticker = $1 ORDER BY created_at DESC LIMIT $2`,
        [ticker.toUpperCase(), limit]
      )
    : await pool.query(`SELECT * FROM trade_scenarios ORDER BY created_at DESC LIMIT $1`, [limit]);

  return result.rows.map((r) => ({
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
