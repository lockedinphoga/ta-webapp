# Chart & Indicator Analyzer

A personal technical-analysis web app: enter a stock ticker, it pulls recent
price history, computes standard indicators (RSI-14, MACD 12/26/9,
SMA-50/200, basic support/resistance), renders a chart, and asks Claude to
interpret both the numbers **and** the chart image for visual patterns
(trends, breakouts, double tops, etc.).

**This tool is for personal analysis only. It is not financial advice.**

## How it works (plain-English overview)

1. You type a ticker (e.g. `AAPL`) and hit Analyze.
2. The server fetches ~100 days of daily price data from **Alpha Vantage**
   (a free stock-data API).
3. The server computes indicators with plain math (see `lib/indicators.ts`
   — every function has comments explaining what it measures and why).
4. The server renders a price chart to an image (`lib/renderChart.ts`).
5. The server sends the indicator numbers *and* the chart image to
   **Claude** (Anthropic's AI), which writes a plain-English interpretation.
6. The page shows three things, kept clearly separate: the chart, the raw
   indicator numbers ("what the data shows"), and the AI's writeup ("what
   the AI concludes").

## One-time setup

### 1. Get two free/paid-as-you-go API keys

- **Alpha Vantage** (stock data, free tier): sign up at
  https://www.alphavantage.co/support/#api-key — takes 30 seconds, no
  credit card. Free tier is rate-limited (~5 requests/minute, 25/day),
  which is fine for personal use but means: don't spam the Analyze button.
- **Anthropic API key** (powers the AI analysis): create one at
  https://console.anthropic.com/settings/keys. This is billed per-use
  (typically fractions of a cent per analysis) — you'll need to add a
  payment method there.

### 2. Configure your keys locally

```bash
cp .env.local.example .env.local
```

Then open `.env.local` and paste in your two keys.

### 3. Install dependencies and run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

## Deploying to Vercel (so you can use it from anywhere)

1. Push this project to a GitHub repository (create a new repo on GitHub,
   then `git remote add origin <your-repo-url>` and `git push -u origin main`).
2. Go to https://vercel.com, sign in (GitHub login works), click
   **Add New... > Project**, and import your repo.
3. When Vercel asks for environment variables, add the same two keys from
   your `.env.local` (`ALPHA_VANTAGE_API_KEY` and `ANTHROPIC_API_KEY`) —
   this is how the deployed server gets access to them without them ever
   being visible in your code.
4. Click Deploy. You'll get a URL like `your-project.vercel.app` you can
   open from any device.

Any time you push new commits to GitHub, Vercel automatically redeploys.

## Project structure

- `app/page.tsx` — the single page UI (ticker input, chart, results).
- `app/api/analyze/route.ts` — the server endpoint that does the real work:
  fetch data, compute indicators, render chart, call Claude.
- `lib/stockData.ts` — talks to Alpha Vantage.
- `lib/indicators.ts` — the indicator math (RSI, MACD, SMA/EMA, support/resistance).
- `lib/renderChart.ts` — renders the price chart to a PNG image server-side.

## Known limitations / things to improve later

- Alpha Vantage's free tier is rate-limited — if you see a rate-limit
  error, wait a minute and try again.
- Support/resistance is a simplified 20-day high/low, not true pivot-point
  detection.
- No caching yet — every Analyze click re-fetches and re-renders from
  scratch. Fine for occasional personal use.
- Single-user app: no login system, since it's meant to run just for you.
