// lib/stockData.ts
//
// Fetches daily price history for a ticker from Alpha Vantage's free API.
//
// WHAT IS ALPHA VANTAGE? It's a market-data provider with a free tier
// (5 requests/minute, 25/day on the free key as of writing). You get a
// key at https://www.alphavantage.co/support/#api-key — no credit card.
// Because the free tier is rate-limited, this app is built for occasional
// personal use, not rapid-fire queries.

import { Candle } from "./indicators";

const ALPHA_VANTAGE_BASE = "https://www.alphavantage.co/query";

export async function fetchDailyCandles(ticker: string): Promise<Candle[]> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing ALPHA_VANTAGE_API_KEY. Add it to your .env.local file (see README)."
    );
  }

  const url = `${ALPHA_VANTAGE_BASE}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(
    ticker
  )}&outputsize=compact&apikey=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Alpha Vantage request failed with status ${res.status}`);
  }
  const data = await res.json();

  // Alpha Vantage returns friendly-sounding error messages inside a 200
  // response instead of using HTTP error codes, so we check for those here.
  if (data["Note"]) {
    // This happens when you hit the free-tier rate limit.
    throw new Error(
      "Alpha Vantage rate limit hit (free tier allows ~5 requests/minute, 25/day). Wait a bit and try again."
    );
  }
  if (data["Error Message"]) {
    throw new Error(`Invalid ticker symbol "${ticker}", or Alpha Vantage couldn't find it.`);
  }
  if (data["Information"]) {
    throw new Error(`Alpha Vantage: ${data["Information"]}`);
  }

  const series = data["Time Series (Daily)"];
  if (!series) {
    throw new Error("Unexpected response from Alpha Vantage (no time series data found).");
  }

  const candles: Candle[] = Object.entries(series)
    .map(([date, values]: [string, any]) => ({
      date,
      open: parseFloat(values["1. open"]),
      high: parseFloat(values["2. high"]),
      low: parseFloat(values["3. low"]),
      close: parseFloat(values["4. close"]),
      volume: parseFloat(values["5. volume"]),
    }))
    // Alpha Vantage returns newest-first; we want oldest-first for
    // indicator math (SMA/EMA/RSI all assume chronological order).
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return candles;
}
