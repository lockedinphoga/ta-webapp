"use client";

// app/page.tsx
//
// This is the main (and only) page of the app: a ticker input box, two
// checkbox groups (which indicators the AI should analyze, and which
// indicators to display on the chart), an interactive multi-panel chart,
// a "what the data shows" panel (raw indicator numbers), and a "what the
// AI concludes" panel (Claude's written interpretation).
//
// "use client" at the top means this component runs in the browser (so it
// can handle button clicks and state), unlike our API route which runs on
// the server.

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine,
  ReferenceDot,
  Cell,
} from "recharts";

// The full list of indicators/patterns the app supports. Both checkbox
// groups (AI analysis, and chart display) are built from this one list so
// they always stay in sync with what the backend/chart actually support.
const INDICATOR_OPTIONS = [
  { key: "sma50", label: "SMA 50" },
  { key: "sma200", label: "SMA 200" },
  { key: "bollinger", label: "Bollinger Bands" },
  { key: "rsi", label: "RSI (14)" },
  { key: "macd", label: "MACD (12, 26, 9)" },
  { key: "supportResistance", label: "Support / Resistance" },
  { key: "crossovers", label: "Golden / Death Cross" },
  { key: "stochastic", label: "Stochastic Oscillator (14, 3, 3)" },
  { key: "adx", label: "ADX (14)" },
  { key: "fibonacci", label: "Fibonacci Retracement" },
  { key: "ichimoku", label: "Ichimoku Cloud" },
  { key: "stdDev", label: "Standard Deviation (20)" },
] as const;

type IndicatorKey = (typeof INDICATOR_OPTIONS)[number]["key"];

function allOn(): Record<IndicatorKey, boolean> {
  return Object.fromEntries(INDICATOR_OPTIONS.map((o) => [o.key, true])) as Record<IndicatorKey, boolean>;
}

interface SeriesPoint {
  date: string;
  close: number;
  volume: number;
  sma50: number | null;
  sma200: number | null;
  bollingerUpper: number | null;
  bollingerMiddle: number | null;
  bollingerLower: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  stochasticK: number | null;
  stochasticD: number | null;
  adx14: number | null;
  plusDI14: number | null;
  minusDI14: number | null;
  stdDev20: number | null;
  tenkanSen: number | null;
  kijunSen: number | null;
  senkouA: number | null;
  senkouB: number | null;
  chikouSpan: number | null;
}

interface FibLevel {
  pct: number;
  price: number;
}

interface Crossover {
  date: string;
  index: number;
  type: "golden-cross" | "death-cross";
  price: number;
}

interface TradeScenario {
  bias: "long" | "short" | "neutral";
  confidence: "low" | "medium" | "high";
  reasoning: string;
  entryZone?: string;
  stopLoss: number;
  stopLossReasoning: string;
  target: number;
  targetReasoning: string;
  holdingPeriodDays: number;
  holdingPeriodLabel: string;
}

// One saved row from your trade-scenario history (see lib/db.ts /
// app/api/history/route.ts). This is the permanent record of a past
// scenario: what was recommended, AND which indicators were checked at
// the time — "what signal indicated what."
interface HistoryEntry {
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
  usedIndicators: string[];
}

interface AnalyzeResponse {
  ticker: string;
  series: SeriesPoint[];
  indicators: {
    lastClose: number;
    rsi14: number | null;
    sma50: number | null;
    sma200: number | null;
    macd: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    bollingerUpper: number | null;
    bollingerMiddle: number | null;
    bollingerLower: number | null;
    stochasticK?: number | null;
    stochasticD?: number | null;
    adx14?: number | null;
    plusDI14?: number | null;
    minusDI14?: number | null;
    stdDev20?: number | null;
  };
  support: number;
  resistance: number;
  crossovers: Crossover[];
  aiAnalysis: string;
  tradeScenario: TradeScenario | null;
  atr14: number | null;
  fibonacciLevels?: FibLevel[];
}

export default function Home() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  // Two independent sets of checkboxes:
  // - useIndicators: sent to the server, controls what the AI is told to
  //   analyze (and what shows up in the chart image the AI sees).
  // - showIndicators: purely client-side, controls what YOU see on the
  //   interactive chart below. Changing these doesn't require re-analyzing
  //   — the server already sent back every indicator's full data.
  const [useIndicators, setUseIndicators] = useState<Record<IndicatorKey, boolean>>(allOn());
  const [showIndicators, setShowIndicators] = useState<Record<IndicatorKey, boolean>>(allOn());
  // Whether to ask the AI for a structured long/short scenario (bias,
  // stop-loss, target, holding period) on top of the written analysis.
  const [includeTradeScenario, setIncludeTradeScenario] = useState(true);

  // Your saved trade-scenario history (see lib/db.ts) — every past
  // scenario, remembered across visits/devices, along with which
  // indicators were in play for each one.
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyTickerFilter, setHistoryTickerFilter] = useState("");

  async function loadHistory(tickerFilter?: string) {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const qs = tickerFilter ? `?ticker=${encodeURIComponent(tickerFilter)}` : "";
      const res = await fetch(`/api/history${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load history.");
      setHistory(data.scenarios);
    } catch (err: any) {
      setHistoryError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  // Load your full history once when the page first opens.
  useEffect(() => {
    loadHistory();
  }, []);

  function toggle(
    setter: React.Dispatch<React.SetStateAction<Record<IndicatorKey, boolean>>>,
    key: IndicatorKey
  ) {
    setter((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, useIndicators, includeTradeScenario }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Request failed.");
      }
      setResult(data);
      // If a trade scenario was generated, it was just saved to your
      // history in the background — refresh the list so it shows up
      // right away without needing a manual reload.
      if (data.tradeScenario) {
        loadHistory(historyTickerFilter || undefined);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-6 sm:p-10">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Chart & Indicator Analyzer</h1>
          <p className="text-sm text-slate-600">
            Personal technical-analysis tool. Enter a ticker to pull recent price data, compute
            standard indicators, and get an AI read on chart patterns.{" "}
            <strong>This is not financial advice.</strong>
          </p>
        </header>

        <form onSubmit={handleAnalyze} className="space-y-4">
          <div className="flex gap-2">
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="e.g. AAPL"
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-blue-600 text-white px-4 py-2 font-medium disabled:opacity-50"
            >
              {loading ? "Analyzing..." : "Analyze"}
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <CheckboxGroup
              title="Include in AI analysis"
              hint="Sent to the AI — it will only discuss what's checked here."
              values={useIndicators}
              onToggle={(key) => toggle(setUseIndicators, key)}
            />
            <CheckboxGroup
              title="Show on chart"
              hint="Just changes what you see below — no need to re-analyze."
              values={showIndicators}
              onToggle={(key) => toggle(setShowIndicators, key)}
            />
          </div>

          <label className="flex items-start gap-2 text-sm bg-white rounded-md border border-slate-200 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeTradeScenario}
              onChange={() => setIncludeTradeScenario((v) => !v)}
              className="mt-0.5 rounded border-slate-300"
            />
            <span>
              <span className="font-medium">Include a trade scenario</span> — ask the AI for an
              illustrative long/short bias, stop-loss, target, and holding period, based only on
              the indicators checked above.{" "}
              <span className="text-slate-500">This is educational, not a recommendation.</span>
            </span>
          </label>
        </form>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <HistorySection
          history={history}
          loading={historyLoading}
          error={historyError}
          tickerFilter={historyTickerFilter}
          onTickerFilterChange={(v) => setHistoryTickerFilter(v)}
          onRefresh={() => loadHistory(historyTickerFilter || undefined)}
        />

        {result && (
          <div className="space-y-8">
            {/* Panel 1: price + whichever overlays are checked under "Show on chart" */}
            <section>
              <h2 className="font-semibold mb-2">
                {result.ticker} — Price chart
              </h2>
              <div className="bg-white rounded-md border border-slate-200 p-4">
                <ResponsiveContainer width="100%" height={340}>
                  <ComposedChart data={result.series}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="close" name="Close" stroke="#2563eb" strokeWidth={2} dot={false} />
                    {showIndicators.sma50 && (
                      <Line type="monotone" dataKey="sma50" name="SMA 50" stroke="#ea580c" strokeDasharray="4 4" dot={false} />
                    )}
                    {showIndicators.sma200 && (
                      <Line type="monotone" dataKey="sma200" name="SMA 200" stroke="#dc2626" strokeDasharray="2 2" dot={false} />
                    )}
                    {showIndicators.bollinger && (
                      <>
                        <Line type="monotone" dataKey="bollingerUpper" name="Bollinger Upper" stroke="#9ca3af" dot={false} strokeWidth={1} />
                        <Line type="monotone" dataKey="bollingerLower" name="Bollinger Lower" stroke="#9ca3af" dot={false} strokeWidth={1} />
                      </>
                    )}
                    {showIndicators.supportResistance && (
                      <>
                        <ReferenceLine
                          y={result.support}
                          stroke="#16a34a"
                          strokeDasharray="6 4"
                          label={{ value: `Support ${result.support.toFixed(2)}`, fontSize: 10, position: "insideBottomLeft" }}
                        />
                        <ReferenceLine
                          y={result.resistance}
                          stroke="#dc2626"
                          strokeDasharray="6 4"
                          label={{ value: `Resistance ${result.resistance.toFixed(2)}`, fontSize: 10, position: "insideTopLeft" }}
                        />
                      </>
                    )}
                    {showIndicators.ichimoku && (
                      <>
                        <Line type="monotone" dataKey="tenkanSen" name="Tenkan-sen (9)" stroke="#0891b2" dot={false} strokeWidth={1} />
                        <Line type="monotone" dataKey="kijunSen" name="Kijun-sen (26)" stroke="#be185d" dot={false} strokeWidth={1} />
                      </>
                    )}
                    {showIndicators.fibonacci &&
                      result.fibonacciLevels?.map((lvl) => (
                        <ReferenceLine
                          key={lvl.pct}
                          y={lvl.price}
                          stroke="#a855f7"
                          strokeDasharray="2 6"
                          label={{
                            value: `Fib ${(lvl.pct * 100).toFixed(1)}% (${lvl.price.toFixed(2)})`,
                            fontSize: 9,
                            position: "right",
                          }}
                        />
                      ))}
                    {showIndicators.crossovers &&
                      result.crossovers.map((c) => (
                        <ReferenceDot
                          key={c.date + c.type}
                          x={c.date}
                          y={c.price}
                          r={5}
                          fill={c.type === "golden-cross" ? "#eab308" : "#0f172a"}
                          stroke="white"
                          label={{
                            value: c.type === "golden-cross" ? "Golden Cross" : "Death Cross",
                            fontSize: 9,
                            position: c.type === "golden-cross" ? "top" : "bottom",
                          }}
                        />
                      ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Panel 2: RSI, only if checked */}
            {showIndicators.rsi && (
              <section>
                <h2 className="font-semibold mb-2">RSI (14)</h2>
                <div className="bg-white rounded-md border border-slate-200 p-4">
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={result.series}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <ReferenceLine y={70} stroke="#dc2626" strokeDasharray="4 4" label={{ value: "Overbought 70", fontSize: 9 }} />
                      <ReferenceLine y={30} stroke="#16a34a" strokeDasharray="4 4" label={{ value: "Oversold 30", fontSize: 9 }} />
                      <Line type="monotone" dataKey="rsi14" name="RSI (14)" stroke="#7c3aed" dot={false} strokeWidth={1.5} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* Panel 3: MACD, only if checked */}
            {showIndicators.macd && (
              <section>
                <h2 className="font-semibold mb-2">MACD (12, 26, 9)</h2>
                <div className="bg-white rounded-md border border-slate-200 p-4">
                  <ResponsiveContainer width="100%" height={180}>
                    <ComposedChart data={result.series}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="macdHistogram" name="Histogram">
                        {result.series.map((entry, idx) => (
                          <Cell key={idx} fill={(entry.macdHistogram ?? 0) >= 0 ? "#16a34a" : "#dc2626"} />
                        ))}
                      </Bar>
                      <Line type="monotone" dataKey="macd" name="MACD line" stroke="#2563eb" dot={false} strokeWidth={1.5} />
                      <Line type="monotone" dataKey="macdSignal" name="Signal line" stroke="#ea580c" dot={false} strokeWidth={1.5} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* Panel 4: Stochastic Oscillator, only if checked */}
            {showIndicators.stochastic && (
              <section>
                <h2 className="font-semibold mb-2">Stochastic Oscillator (14, 3, 3)</h2>
                <div className="bg-white rounded-md border border-slate-200 p-4">
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={result.series}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={80} stroke="#dc2626" strokeDasharray="4 4" label={{ value: "Overbought 80", fontSize: 9 }} />
                      <ReferenceLine y={20} stroke="#16a34a" strokeDasharray="4 4" label={{ value: "Oversold 20", fontSize: 9 }} />
                      <Line type="monotone" dataKey="stochasticK" name="%K" stroke="#2563eb" dot={false} strokeWidth={1.5} />
                      <Line type="monotone" dataKey="stochasticD" name="%D (signal)" stroke="#ea580c" dot={false} strokeWidth={1.5} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* Panel 5: ADX, only if checked */}
            {showIndicators.adx && (
              <section>
                <h2 className="font-semibold mb-2">ADX (14) — trend strength</h2>
                <div className="bg-white rounded-md border border-slate-200 p-4">
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={result.series}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={25} stroke="#64748b" strokeDasharray="4 4" label={{ value: "Trending 25", fontSize: 9 }} />
                      <Line type="monotone" dataKey="adx14" name="ADX" stroke="#0f172a" dot={false} strokeWidth={2} />
                      <Line type="monotone" dataKey="plusDI14" name="+DI" stroke="#16a34a" dot={false} strokeWidth={1} />
                      <Line type="monotone" dataKey="minusDI14" name="-DI" stroke="#dc2626" dot={false} strokeWidth={1} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            <section>
              <h2 className="font-semibold mb-2">What the data shows</h2>
              <div className="bg-white rounded-md border border-slate-200 p-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <Stat label="Last close" value={result.indicators.lastClose?.toFixed(2)} />
                {useIndicators.rsi && <Stat label="RSI (14)" value={result.indicators.rsi14?.toFixed(1)} />}
                {useIndicators.sma50 && <Stat label="SMA 50" value={result.indicators.sma50?.toFixed(2)} />}
                {useIndicators.sma200 && <Stat label="SMA 200" value={result.indicators.sma200?.toFixed(2)} />}
                {useIndicators.macd && <Stat label="MACD" value={result.indicators.macd?.toFixed(3)} />}
                {useIndicators.macd && <Stat label="MACD signal" value={result.indicators.macdSignal?.toFixed(3)} />}
                {useIndicators.bollinger && <Stat label="Bollinger upper" value={result.indicators.bollingerUpper?.toFixed(2)} />}
                {useIndicators.bollinger && <Stat label="Bollinger lower" value={result.indicators.bollingerLower?.toFixed(2)} />}
                {useIndicators.supportResistance && <Stat label="Support (20d low)" value={result.support?.toFixed(2)} />}
                {useIndicators.supportResistance && <Stat label="Resistance (20d high)" value={result.resistance?.toFixed(2)} />}
                {useIndicators.crossovers && (
                  <Stat
                    label="Recent MA crossover"
                    value={
                      result.crossovers.length > 0
                        ? `${result.crossovers[result.crossovers.length - 1].type} on ${result.crossovers[result.crossovers.length - 1].date}`
                        : "None recently"
                    }
                  />
                )}
                {useIndicators.stochastic && (
                  <>
                    <Stat label="Stochastic %K" value={result.indicators.stochasticK?.toFixed(1)} />
                    <Stat label="Stochastic %D" value={result.indicators.stochasticD?.toFixed(1)} />
                  </>
                )}
                {useIndicators.adx && (
                  <>
                    <Stat label="ADX (14)" value={result.indicators.adx14?.toFixed(1)} />
                    <Stat label="+DI / -DI" value={`${result.indicators.plusDI14?.toFixed(1)} / ${result.indicators.minusDI14?.toFixed(1)}`} />
                  </>
                )}
                {useIndicators.stdDev && (
                  <Stat label="Std. deviation (20d)" value={result.indicators.stdDev20?.toFixed(2)} />
                )}
                {useIndicators.fibonacci && result.fibonacciLevels && (
                  <Stat
                    label="Fib range (60d)"
                    value={`${result.fibonacciLevels[result.fibonacciLevels.length - 1].price.toFixed(2)} – ${result.fibonacciLevels[0].price.toFixed(2)}`}
                  />
                )}
              </div>
            </section>

            <section>
              <h2 className="font-semibold mb-2">What the AI concludes</h2>
              <div className="bg-white rounded-md border border-slate-200 p-4 text-sm whitespace-pre-wrap leading-relaxed">
                {result.aiAnalysis}
              </div>
            </section>

            {result.tradeScenario && <TradeScenarioCard scenario={result.tradeScenario} atr14={result.atr14} />}
          </div>
        )}
      </div>
    </main>
  );
}

function CheckboxGroup({
  title,
  hint,
  values,
  onToggle,
}: {
  title: string;
  hint: string;
  values: Record<IndicatorKey, boolean>;
  onToggle: (key: IndicatorKey) => void;
}) {
  return (
    <fieldset className="bg-white rounded-md border border-slate-200 p-3">
      <legend className="text-sm font-medium px-1">{title}</legend>
      <p className="text-xs text-slate-500 mb-2">{hint}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {INDICATOR_OPTIONS.map((opt) => (
          <label key={opt.key} className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={values[opt.key]}
              onChange={() => onToggle(opt.key)}
              className="rounded border-slate-300"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Displays the AI's structured long/short scenario. Styled distinctly
// (amber, not the plain white cards above) and with a persistent
// disclaimer, so it reads as a labeled "what-if" the AI generated —
// never as a recommendation to actually trade. Per the project's rule to
// keep "what the data shows" separate from "what the AI concludes," this
// is clearly the latter, one step further (a synthesized scenario, not
// just an interpretation).
function TradeScenarioCard({ scenario, atr14 }: { scenario: TradeScenario; atr14: number | null }) {
  const biasColor =
    scenario.bias === "long" ? "text-green-700 bg-green-100" : scenario.bias === "short" ? "text-red-700 bg-red-100" : "text-slate-700 bg-slate-200";

  return (
    <section>
      <h2 className="font-semibold mb-2">Trade scenario (educational only)</h2>
      <div className="bg-amber-50 rounded-md border border-amber-300 p-4 text-sm space-y-4">
        <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2 text-amber-900 text-xs leading-relaxed">
          <strong>Not financial advice.</strong> This is an illustrative scenario generated from
          the indicators you selected — not a recommendation to buy or sell. Verify independently
          and consider your own risk tolerance before acting on anything here.
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2 py-1 rounded font-semibold uppercase text-xs ${biasColor}`}>
            {scenario.bias}
          </span>
          <span className="text-xs text-slate-500">Confidence: {scenario.confidence}</span>
        </div>

        <p className="leading-relaxed">{scenario.reasoning}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {scenario.entryZone && <Stat label="Entry zone" value={scenario.entryZone} />}
          <Stat label="Stop-loss" value={scenario.stopLoss?.toFixed(2)} />
          <Stat label="Target" value={scenario.target?.toFixed(2)} />
          <Stat label="Suggested holding period" value={scenario.holdingPeriodLabel} />
        </div>

        <div className="text-xs text-slate-600 space-y-1">
          <p>
            <strong>Why this stop:</strong> {scenario.stopLossReasoning}
            {atr14 !== null && <> (ATR-14 is currently {atr14.toFixed(2)}, i.e. the stock typically moves about that much per day.)</>}
          </p>
          <p>
            <strong>Why this target:</strong> {scenario.targetReasoning}
          </p>
        </div>
      </div>
    </section>
  );
}

// Shows your saved trade-scenario history — every past scenario the app
// has generated, remembered in a real database (see lib/db.ts) so it's
// still here next time you open the app, even on a different device.
// Each entry shows exactly which indicators were checked at the time,
// answering "what signal indicated what."
function HistorySection({
  history,
  loading,
  error,
  tickerFilter,
  onTickerFilterChange,
  onRefresh,
}: {
  history: HistoryEntry[];
  loading: boolean;
  error: string | null;
  tickerFilter: string;
  onTickerFilterChange: (value: string) => void;
  onRefresh: () => void;
}) {
  const biasColor = (bias: HistoryEntry["bias"]) =>
    bias === "long" ? "text-green-700 bg-green-100" : bias === "short" ? "text-red-700 bg-red-100" : "text-slate-700 bg-slate-200";

  return (
    <section>
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h2 className="font-semibold">History</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onRefresh();
          }}
          className="flex gap-2"
        >
          <input
            value={tickerFilter}
            onChange={(e) => onTickerFilterChange(e.target.value)}
            placeholder="Filter by ticker (optional)"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="text-sm rounded-md border border-slate-300 px-3 py-1 bg-white hover:bg-slate-50">
            {loading ? "Loading..." : "Filter"}
          </button>
        </form>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm mb-2">
          {error}
          {error.includes("DATABASE_URL") && (
            <p className="mt-1 text-xs">
              History needs a database connected — see the README for the one-time Vercel Postgres setup.
            </p>
          )}
        </div>
      )}

      {!error && history.length === 0 && !loading && (
        <p className="text-sm text-slate-500 bg-white rounded-md border border-slate-200 p-4">
          No saved scenarios yet — run an analysis with &quot;Include a trade scenario&quot; checked, and it&apos;ll show up here.
        </p>
      )}

      {history.length > 0 && (
        <div className="bg-white rounded-md border border-slate-200 divide-y divide-slate-100">
          {history.map((h) => (
            <div key={h.id} className="p-3 text-sm space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{h.ticker}</span>
                <span className={`px-2 py-0.5 rounded font-semibold uppercase text-xs ${biasColor(h.bias)}`}>{h.bias}</span>
                <span className="text-xs text-slate-500">{new Date(h.createdAt).toLocaleString()}</span>
                <span className="text-xs text-slate-500">Confidence: {h.confidence}</span>
              </div>
              <p className="text-slate-700">{h.reasoning}</p>
              <div className="flex flex-wrap gap-4 text-xs text-slate-600">
                <span>Stop-loss: <strong>{h.stopLoss.toFixed(2)}</strong></span>
                <span>Target: <strong>{h.target.toFixed(2)}</strong></span>
                <span>Holding: <strong>{h.holdingPeriodLabel}</strong></span>
                {h.lastClose !== null && <span>Price then: <strong>{h.lastClose.toFixed(2)}</strong></span>}
              </div>
              {h.usedIndicators?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {h.usedIndicators.map((ind) => (
                    <span key={ind} className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
                      {ind}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <div>
      <div className="text-slate-500 text-xs">{label}</div>
      <div className="font-medium">{value ?? "—"}</div>
    </div>
  );
}
