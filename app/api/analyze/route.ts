// app/api/analyze/route.ts
//
// This is a Next.js "API route" — a server-side endpoint at /api/analyze.
// WHY A SERVER ROUTE? Two reasons: (1) our Alpha Vantage and Anthropic API
// keys must stay secret, so all calls using them have to happen on the
// server, never in browser code where anyone could view them; (2) chart
// rendering (chartjs-node-canvas) needs a Node.js environment.
//
// Flow: ticker + selected indicators in -> fetch price history -> compute
// EVERY indicator (cheap, plain math) -> render a chart image showing only
// the SELECTED indicators/patterns -> send the selected indicators (as
// data) + that chart (as an image) to Claude, so the AI only comments on
// what the user actually asked about -> return everything to the
// frontend, which always gets the full computed series back so its
// "show on chart" checkboxes can toggle display instantly without
// re-fetching or re-asking the AI.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { fetchDailyCandles } from "@/lib/stockData";
import {
  summarizeIndicators,
  sma,
  rsi,
  macd,
  bollingerBands,
  findMovingAverageCrossovers,
  supportResistance,
  atr,
  standardDeviation,
  stochasticOscillator,
  adx,
  fibonacciRetracement,
  ichimokuCloud,
} from "@/lib/indicators";
import { renderAnalysisChartPng, EnabledIndicators } from "@/lib/renderChart";

const ALL_ENABLED: Required<EnabledIndicators> = {
  sma50: true,
  sma200: true,
  bollinger: true,
  rsi: true,
  macd: true,
  supportResistance: true,
  crossovers: true,
  stochastic: true,
  adx: true,
  fibonacci: true,
  ichimoku: true,
  stdDev: true,
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ticker } = body;
    // Which indicators the user checked "include in AI analysis." Any key
    // not present defaults to true, so old requests without this field
    // still behave like before (everything included).
    const useIndicators: EnabledIndicators = { ...ALL_ENABLED, ...(body.useIndicators ?? {}) };
    // Whether to also ask the AI for a structured, educational long/short
    // scenario (bias, stop-loss, target, holding period). Defaults on;
    // pass includeTradeScenario: false from the frontend to skip it.
    const includeTradeScenario: boolean = body.includeTradeScenario !== false;

    if (!ticker || typeof ticker !== "string") {
      return NextResponse.json({ error: "Please provide a stock ticker." }, { status: 400 });
    }
    const cleanTicker = ticker.trim().toUpperCase();

    // 1. Get price history
    const candles = await fetchDailyCandles(cleanTicker);
    if (candles.length < 30) {
      return NextResponse.json(
        { error: "Not enough price history returned to analyze." },
        { status: 400 }
      );
    }

    // 2. Compute every indicator's full series regardless of what's
    // selected — this is cheap plain math, and it means the frontend
    // always has everything on hand to toggle "show on chart" instantly.
    const closes = candles.map((c) => c.close);
    const summary = summarizeIndicators(candles);
    const sma50Series = sma(closes, 50);
    const sma200Series = sma(closes, 200);
    const rsiSeries = rsi(closes, 14);
    const { macdLine, signalLine, histogram } = macd(closes);
    const bands = bollingerBands(closes, 20, 2);
    const { support, resistance } = supportResistance(candles, 20);
    const crossovers = findMovingAverageCrossovers(candles, sma50Series, sma200Series);
    const atrSeries = atr(candles, 14);
    const latestAtr = atrSeries[atrSeries.length - 1];
    const stdDevSeries = standardDeviation(closes, 20);
    const { percentK, percentD } = stochasticOscillator(candles);
    const { adx: adxLine, plusDI, minusDI } = adx(candles, 14);
    const fib = fibonacciRetracement(candles, 60);
    const ichimoku = ichimokuCloud(candles);

    // 3. Render the chart image showing only the SELECTED indicators/
    // patterns — this is the picture the AI actually looks at, so it
    // should match what the user asked it to consider.
    const chartPngBuffer = await renderAnalysisChartPng({
      candles,
      sma50: sma50Series,
      sma200: sma200Series,
      bollingerUpper: bands.upper,
      bollingerMiddle: bands.middle,
      bollingerLower: bands.lower,
      rsiSeries,
      macdLine,
      macdSignal: signalLine,
      macdHistogram: histogram,
      support,
      resistance,
      crossovers,
      stochasticK: percentK,
      stochasticD: percentD,
      adxLine,
      plusDI,
      minusDI,
      fibLevels: fib.levels,
      ichimoku,
      enabled: useIndicators,
    });
    const chartBase64 = chartPngBuffer.toString("base64");

    // 4. Build the indicator summary sent to the AI, keeping only the
    // fields for indicators the user selected — so the AI's writeup only
    // discusses what was asked for.
    const filteredSummary: Record<string, unknown> = { lastClose: summary.lastClose };
    if (useIndicators.rsi) filteredSummary.rsi14 = summary.rsi14;
    if (useIndicators.sma50) filteredSummary.sma50 = summary.sma50;
    if (useIndicators.sma200) filteredSummary.sma200 = summary.sma200;
    if (useIndicators.macd) {
      filteredSummary.macd = summary.macd;
      filteredSummary.macdSignal = summary.macdSignal;
      filteredSummary.macdHistogram = summary.macdHistogram;
    }
    if (useIndicators.bollinger) {
      filteredSummary.bollingerUpper = summary.bollingerUpper;
      filteredSummary.bollingerMiddle = summary.bollingerMiddle;
      filteredSummary.bollingerLower = summary.bollingerLower;
    }
    if (useIndicators.supportResistance) {
      filteredSummary.support = support;
      filteredSummary.resistance = resistance;
    }
    if (useIndicators.crossovers) {
      filteredSummary.recentCrossovers = summary.recentCrossovers;
    }
    if (useIndicators.stochastic) {
      filteredSummary.stochasticK = summary.stochasticK;
      filteredSummary.stochasticD = summary.stochasticD;
    }
    if (useIndicators.adx) {
      filteredSummary.adx14 = summary.adx14;
      filteredSummary.plusDI14 = summary.plusDI14;
      filteredSummary.minusDI14 = summary.minusDI14;
    }
    if (useIndicators.fibonacci) {
      filteredSummary.fibonacciLevels = fib.levels;
    }
    if (useIndicators.ichimoku) {
      const lastIdx = candles.length - 1;
      filteredSummary.ichimoku = {
        tenkanSen: ichimoku.tenkanSen[lastIdx],
        kijunSen: ichimoku.kijunSen[lastIdx],
        // Senkou spans are plotted displacement days AHEAD, so "current
        // cloud" for today is the value computed `displacement` days ago.
        currentCloudSpanA: ichimoku.senkouA[lastIdx],
        currentCloudSpanB: ichimoku.senkouB[lastIdx],
      };
    }
    if (useIndicators.stdDev) {
      filteredSummary.stdDev20 = summary.stdDev20;
    }
    // ATR isn't one of the "display" indicators — it's the volatility
    // measure the trade scenario below uses to size a stop-loss, so we
    // include it whenever a scenario is requested, regardless of which
    // display checkboxes are on.
    if (includeTradeScenario && latestAtr !== null) {
      filteredSummary.atr14 = latestAtr;
    }

    const selectedNames = Object.entries(useIndicators)
      .filter(([, on]) => on)
      .map(([key]) => key)
      .join(", ");

    // This tool definition is how we get a reliable, structured "trade
    // scenario" out of the AI instead of trying to parse free-form text.
    // Anthropic's API lets a model call a "tool" with arguments matching a
    // schema we define — here we're not using it to fetch data, just as a
    // structured-output format the model fills in.
    //
    // IMPORTANT FRAMING: this is explicitly an educational/illustrative
    // scenario, not investment advice. The prompt below instructs the
    // model accordingly, and the frontend displays it with a prominent
    // disclaimer — see the project's rule to keep "what the data shows"
    // separate from "what the AI concludes," and to never present this as
    // a directive to trade.
    const tradeScenarioTool = {
      name: "trade_scenario",
      description:
        "Records a structured, educational long/short scenario based on the selected indicators. This is illustrative only, not a trade directive.",
      input_schema: {
        type: "object" as const,
        properties: {
          bias: {
            type: "string" as const,
            enum: ["long", "short", "neutral"],
            description: "Which direction the selected indicators lean, if any. Use 'neutral' when signals conflict or are too weak to lean either way.",
          },
          confidence: {
            type: "string" as const,
            enum: ["low", "medium", "high"],
            description: "How strongly the selected indicators agree with each other.",
          },
          reasoning: {
            type: "string" as const,
            description: "1-3 sentences explaining the bias using ONLY the selected indicators.",
          },
          entryZone: {
            type: "string" as const,
            description: "A plain-language description of where an entry might be considered (e.g. 'near current price around $142' or 'on a pullback to the 50-day SMA around $138').",
          },
          stopLoss: {
            type: "number" as const,
            description: "A specific stop-loss price level, reasoned from ATR (volatility) and/or support/resistance — whichever are available.",
          },
          stopLossReasoning: {
            type: "string" as const,
            description: "One sentence on how the stop level was chosen (e.g. '1.5x ATR below entry' or 'just below support').",
          },
          target: {
            type: "number" as const,
            description: "A specific take-profit price level.",
          },
          targetReasoning: {
            type: "string" as const,
            description: "One sentence on how the target was chosen (e.g. 'prior resistance level').",
          },
          holdingPeriodDays: {
            type: "number" as const,
            description: "A rough suggested holding horizon IN TRADING DAYS (e.g. 3 for a few days, 10 for two weeks, 40 for a couple months), based on which indicators were selected — momentum indicators (RSI/MACD) imply shorter horizons, long moving averages (SMA-200) imply longer ones.",
          },
          holdingPeriodLabel: {
            type: "string" as const,
            description: "Plain-language version of the holding period (e.g. 'a few days', '2-3 weeks', '1-2 months').",
          },
        },
        required: ["bias", "confidence", "reasoning", "stopLoss", "stopLossReasoning", "target", "targetReasoning", "holdingPeriodDays", "holdingPeriodLabel"],
      },
    };

    // 5. Ask Claude to interpret both the numbers and the picture.
    // ("what the AI concludes" — kept separate from the raw numbers above)
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Missing ANTHROPIC_API_KEY. Add it to your .env.local file (see README).");
    }
    const anthropic = new Anthropic({ apiKey });

    const recentCandles = candles.slice(-30); // last ~6 weeks, keeps the prompt small

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1600,
      tools: includeTradeScenario ? [tradeScenarioTool] : undefined,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are assisting a single trader in analyzing a stock chart. This is for personal, educational analysis only, NOT financial advice — the person you're helping already knows this and is a beginner learning technical analysis.

Ticker: ${cleanTicker}

The user selected these indicators/patterns to analyze: ${selectedNames || "none — just the raw price"}.
Only discuss the indicators/patterns listed above in your written analysis. Do not comment on ones the user didn't select, even if you can infer them from the price data.

Computed values for the selected indicators:
${JSON.stringify(filteredSummary, null, 2)}

Last 30 daily candles (oldest to newest):
${JSON.stringify(recentCandles, null, 2)}

The attached chart image shows price plus only the selected overlays/panels above.

Please:
1. Identify any chart patterns visible in the price panel that relate to what was selected (trend, breakout, double top/bottom, head-and-shoulders, channel, Bollinger Band squeeze, support/resistance tests — whichever apply). Be honest if nothing distinct stands out.
2. Interpret what the selected indicators suggest about momentum and trend.
3. If support/resistance was selected, note current levels and what a break above/below might signal.
4. Give a brief, balanced summary (not a buy/sell recommendation).

Keep your answer concise and structured with short headers.${
                includeTradeScenario
                  ? `\n\nAfter writing the analysis above, call the trade_scenario tool exactly once. Base it ONLY on the selected indicators and the ATR (volatility) figure provided — do not invent information you weren't given. Be honest and use "neutral" bias with low confidence if the signals genuinely conflict or are weak; do not force a long or short call just to fill the field. Remember this scenario is illustrative, not a directive — the person will decide for themselves.`
                  : ""
              }`,
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: chartBase64,
              },
            },
          ],
        },
      ],
    });

    const aiText = message.content
      .filter((block) => block.type === "text")
      .map((block: any) => block.text)
      .join("\n");

    // Pull out the structured trade scenario, if the model called the tool.
    const toolUseBlock = message.content.find(
      (block: any) => block.type === "tool_use" && block.name === "trade_scenario"
    ) as any;
    const tradeScenario = toolUseBlock ? toolUseBlock.input : null;

    // Bundle per-day series into one array so the frontend can plot a
    // single ResponsiveContainer per panel without juggling parallel arrays.
    // NOTE: this includes every indicator regardless of selection, so the
    // frontend's "show on chart" checkboxes can toggle instantly.
    const series = candles.map((c, i) => ({
      date: c.date,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      sma50: sma50Series[i],
      sma200: sma200Series[i],
      bollingerUpper: bands.upper[i],
      bollingerMiddle: bands.middle[i],
      bollingerLower: bands.lower[i],
      rsi14: rsiSeries[i],
      macd: macdLine[i],
      macdSignal: signalLine[i],
      macdHistogram: histogram[i],
      stochasticK: percentK[i],
      stochasticD: percentD[i],
      adx14: adxLine[i],
      plusDI14: plusDI[i],
      minusDI14: minusDI[i],
      stdDev20: stdDevSeries[i],
      tenkanSen: ichimoku.tenkanSen[i],
      kijunSen: ichimoku.kijunSen[i],
      senkouA: ichimoku.senkouA[i],
      senkouB: ichimoku.senkouB[i],
      chikouSpan: ichimoku.chikouSpan[i],
    }));

    return NextResponse.json({
      ticker: cleanTicker,
      series,
      indicators: summary,
      support,
      resistance,
      crossovers,
      usedIndicators: useIndicators,
      chartImageBase64: chartBase64,
      aiAnalysis: aiText,
      tradeScenario,
      atr14: latestAtr,
      fibonacciLevels: fib.levels,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message ?? "Something went wrong analyzing this ticker." },
      { status: 500 }
    );
  }
}
