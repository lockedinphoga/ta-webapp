// lib/renderChart.ts
//
// Renders a multi-panel technical-analysis chart to a PNG image on the
// SERVER (not in the browser). Why server-side? We need to hand the image
// to the AI as part of the same request that fetches data and computes
// indicators — the AI "looks at" this exact picture, the same way a human
// would eyeball a chart for patterns that are easier to see visually than
// to compute as pure numbers.
//
// Panels, top to bottom (each one only appears if its indicator is
// selected — see EnabledIndicators below):
//   1. Price — as Japanese candlesticks (see below) — with SMA-50/200,
//      Bollinger Bands, Ichimoku Cloud, and Fibonacci Retracement levels
//      overlaid, plus support/resistance lines and golden/death-cross
//      markers annotated directly on it.
//   2. RSI-14, with the standard 70/30 overbought/oversold lines.
//   3. Stochastic Oscillator (%K/%D), with the standard 80/20 lines.
//   4. ADX (+DI/-DI/ADX line), with the standard "trending" 25 line.
//   5. MACD line, signal line, and histogram.
//
// WHAT ARE "JAPANESE CANDLESTICKS"? Each day is drawn as a small bar: a
// thin "wick" spanning the day's full high-to-low range, and a thicker
// "body" spanning open-to-close, colored green if the close was higher
// than the open (an "up" day) or red if lower (a "down" day). They
// originated in 18th-century Japanese rice trading and are the standard
// way price charts are drawn today — they pack open/high/low/close into
// one visual instead of just a line through closing prices, which is what
// lets you spot many classic chart patterns (doji, engulfing candles,
// hammers, etc.) at a glance.
//
// We use chartjs-node-canvas (runs Chart.js in Node, no browser needed),
// chartjs-plugin-annotation for the horizontal lines and markers,
// chartjs-chart-financial for the candlestick chart type, and
// chartjs-adapter-date-fns so Chart.js can format real calendar dates on
// a time-based axis (candlesticks need a genuine time axis, unlike our
// other panels which use a simple category axis of date labels).

import type { ChartJSNodeCanvas as ChartJSNodeCanvasType } from "chartjs-node-canvas";
import { Candle } from "./indicators";

const width = 1000;

// IMPORTANT: all of the Chart.js setup below (requiring the plugin
// packages, constructing ChartJSNodeCanvas) is done LAZILY, inside this
// function, instead of at module top-level. Next.js runs a build-time
// "collect page data" pass that imports every route module just to read
// its exported config — it does NOT mean to actually execute chart-
// rendering logic, but top-level code runs regardless of why the module
// was imported. That static pass turned out to run in an environment
// where Chart.js's own self-initialization doesn't fully complete,
// causing a "Cannot read properties of undefined (reading '_adapters')"
// crash purely from evaluating this file — before a single real request
// ever came in. Wrapping the setup in a function means it only runs the
// first time renderAnalysisChartPng is actually called.
//
// IMPORTANT (2): Next.js's dev server can also re-run a module's
// top-level code on hot reloads without fully restarting the Node
// process. If `new ChartJSNodeCanvas(...)` ran again, it would
// re-register the annotation plugin against the same underlying Chart.js
// instance, corrupting its internal option defaults ("Cannot read
// properties of undefined (reading 'borderCapStyle')" the next time a
// chart with annotations is drawn). Stashing the instance on `globalThis`
// (which DOES survive both hot reloads and being wrapped in a function)
// makes sure we only ever create it, and register everything, once per
// server process.
const globalForChart = globalThis as unknown as { __taChartCanvas?: ChartJSNodeCanvasType };

async function getChartCanvas(): Promise<ChartJSNodeCanvasType> {
  if (globalForChart.__taChartCanvas) return globalForChart.__taChartCanvas;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

  // chartjs-plugin-annotation ships two builds — an ESM bundle and a
  // CommonJS ("CJS") bundle — and they are NOT identical. As of version
  // 3.1.0, the ESM bundle has a real bug in how it resolves a "label" on
  // a line-type annotation (like our support/resistance lines): it
  // crashes with "Cannot read properties of undefined (reading
  // 'borderCapStyle')" the moment Chart.js tries to draw one. The CJS
  // bundle does not have this bug. Next.js's bundler (Turbopack) picks
  // the ESM build by default for a normal `import`, so we force Node's
  // `require()` here instead, which resolves to the working CJS build.
  // "chartjs-plugin-annotation" is listed in next.config.ts's
  // serverExternalPackages, which tells Next/Turbopack to leave
  // `require()` calls to it alone at runtime instead of bundling it.
  // That matters here because a plain CommonJS `require()` (unlike an ES
  // `import`) makes Node's own module resolver pick the package's
  // "require" export condition — the CJS build — which does NOT have the
  // ESM build's bug.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const annotationPlugin = require("chartjs-plugin-annotation");

  // chartjs-chart-financial's own build files self-register the
  // "candlestick" chart type as a side effect, but getting that
  // registration to land on the exact same Chart.js object that actually
  // renders our charts turned out to be a multi-layered problem:
  //
  //  1. Its default (UMD) build has `"type": "module"` in its
  //     package.json, so Turbopack refuses to treat it as an external
  //     package ("Package chartjs-chart-financial can't be external"),
  //     and bundles it instead — which mangles its internal
  //     `require('chart.js/helpers')` call into `undefined`.
  //  2. Requiring its real ESM build (`.esm.js`) avoids that crash, but
  //     that file only *defines* the candlestick classes — it never
  //     calls `Chart.register(...)`. Manually registering those classes
  //     against our own `require("chart.js")` Chart class ran without
  //     error but silently did nothing: the classes' internal `extends
  //     BarController` came from a *different* copy of the "chart.js"
  //     module (the one Turbopack's own ESM-import machinery resolved
  //     for that dynamic `import()`), so Chart.js's registry didn't
  //     recognize them as real controllers.
  //
  // The reliable fix is to skip Turbopack's module system for this one
  // require entirely. `eval("require")` looks up Node's *real*,
  // un-instrumented `require` function at runtime — Turbopack can only
  // rewrite `require("literal string")` calls it can see statically, and
  // it cannot see through a string built via `eval`. That real Node
  // `require` loads the UMD build exactly as plain Node.js would: its
  // internal `require('chart.js')` and `require('chart.js/helpers')`
  // resolve, via Node's own module cache, to the IDENTICAL chart.js
  // module instance our own `require("chart.js")` below uses (because
  // "chart.js" is external — see next.config.ts) — so its self
  // registration attaches to the copy we actually render with.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, no-eval
  const nodeRequire: NodeRequire = eval("require");
  nodeRequire("chart.js");

  // One more wrinkle: chartjs-chart-financial's package.json declares
  // `"type": "module"`, which tells Node to treat EVERY plain .js file in
  // that package as an ES module, no matter what syntax is actually
  // inside it. Its dist/chartjs-chart-financial.js file is genuinely
  // written as old-style UMD (CommonJS-compatible) code, but Node loads
  // it through its ES-module loader anyway because of that package.json
  // flag — and in that context `require` isn't defined, so the file's
  // own `require('chart.js/helpers')` call resolves to `undefined`
  // ("Cannot read properties of undefined (reading 'helpers')").
  //
  // Node makes exactly one exception to "type": "module": a file whose
  // extension is literally `.cjs` is ALWAYS loaded as CommonJS, no matter
  // what the package.json says. So the fix is to make a `.cjs` copy of
  // the exact same file, once, and require that copy instead. This is
  // done lazily (only the first time, cached on disk) rather than as a
  // build step, so it keeps working even if node_modules gets reinstalled.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = nodeRequire("fs") as typeof import("fs");
  const originalPath = nodeRequire.resolve("chartjs-chart-financial/dist/chartjs-chart-financial.js");
  const cjsPath = originalPath.replace(/\.js$/, ".force-cjs.cjs");
  if (!fs.existsSync(cjsPath)) {
    fs.copyFileSync(originalPath, cjsPath);
  }
  nodeRequire(cjsPath);
  //
  // NOTE: we deliberately do NOT use chartjs-adapter-date-fns (Chart.js's
  // usual companion package for calendar-aware date axes). Its own main
  // file uses a real ES-module `import { _adapters } from 'chart.js'`,
  // and Turbopack's CJS-interop for our externalized chart.js doesn't
  // expose `_adapters` the way that import expects — every attempt to
  // load it crashed with "Cannot read properties of undefined (reading
  // '_adapters')". We sidestep the whole problem below by giving the
  // price panel's x-axis type "linear" (plain numbers) instead of "time",
  // using millisecond timestamps as the numbers, with a small tick
  // callback that formats them back into readable dates by hand — no
  // date adapter needed at all.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("chartjs-chart-financial");

  const canvas: ChartJSNodeCanvasType = new ChartJSNodeCanvas({
    width,
    height: 380,
    backgroundColour: "white",
    plugins: { modern: [annotationPlugin] },
  });

  globalForChart.__taChartCanvas = canvas;
  return canvas;
}

// Which indicators/patterns the user has checked "include in AI analysis."
// Every field defaults to true if omitted, so existing callers keep working.
export interface EnabledIndicators {
  sma50?: boolean;
  sma200?: boolean;
  bollinger?: boolean;
  rsi?: boolean;
  macd?: boolean;
  supportResistance?: boolean;
  crossovers?: boolean;
  stochastic?: boolean;
  adx?: boolean;
  fibonacci?: boolean;
  ichimoku?: boolean;
  stdDev?: boolean;
}

interface FibLevel {
  pct: number;
  price: number;
}

interface ChartInputs {
  candles: Candle[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  bollingerUpper: (number | null)[];
  bollingerMiddle: (number | null)[];
  bollingerLower: (number | null)[];
  rsiSeries: (number | null)[];
  macdLine: (number | null)[];
  macdSignal: (number | null)[];
  macdHistogram: (number | null)[];
  support: number;
  resistance: number;
  crossovers: { date: string; type: "golden-cross" | "death-cross"; price: number }[];
  stochasticK: (number | null)[];
  stochasticD: (number | null)[];
  adxLine: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
  fibLevels: FibLevel[];
  ichimoku: {
    tenkanSen: (number | null)[];
    kijunSen: (number | null)[];
    senkouA: (number | null)[];
    senkouB: (number | null)[];
    chikouSpan: (number | null)[];
    displacement: number;
  };
  enabled?: EnabledIndicators;
}

function isOn(enabled: EnabledIndicators | undefined, key: keyof EnabledIndicators): boolean {
  return enabled?.[key] !== false; // undefined/missing = on by default
}

// Converts a "YYYY-MM-DD" date string to a timestamp, for the price
// panel's time-based x-axis (candlesticks require real time values, not
// just category labels).
function toTimestamp(dateStr: string): number {
  return new Date(dateStr).getTime();
}

// Builds an extended array of daily timestamps, `count` days past the
// last real candle — used for Ichimoku's Senkou Spans, which are
// deliberately plotted into the future (see indicators.ts for why).
function extendTimestamps(candles: Candle[], count: number): number[] {
  const lastDate = new Date(candles[candles.length - 1].date);
  const extra: number[] = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(lastDate);
    d.setDate(d.getDate() + i);
    extra.push(d.getTime());
  }
  return extra;
}

// Renders the price panel plus whichever of the RSI/Stochastic/ADX/MACD
// panels are enabled, and stacks them into one tall PNG (chartjs-node-canvas
// draws one chart per canvas, so multi-panel charts are built by
// compositing separately-rendered images).
export async function renderAnalysisChartPng(inputs: ChartInputs): Promise<Buffer> {
  const panels: Buffer[] = [await renderPricePanel(inputs)];
  if (isOn(inputs.enabled, "rsi")) panels.push(await renderRsiPanel(inputs));
  if (isOn(inputs.enabled, "stochastic")) panels.push(await renderStochasticPanel(inputs));
  if (isOn(inputs.enabled, "adx")) panels.push(await renderAdxPanel(inputs));
  if (isOn(inputs.enabled, "macd")) panels.push(await renderMacdPanel(inputs));

  // Stack the PNGs vertically using the "canvas" package that
  // chartjs-node-canvas already depends on.
  const { createCanvas, loadImage } = await import("canvas");
  const images = await Promise.all(panels.map((buf) => loadImage(buf)));
  const totalHeight = images.reduce((sum, img) => sum + img.height, 0);
  const canvas = createCanvas(width, totalHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, totalHeight);
  let y = 0;
  for (const img of images) {
    ctx.drawImage(img as any, 0, y);
    y += img.height;
  }
  return canvas.toBuffer("image/png");
}

function crossoverAnnotations(inputs: ChartInputs) {
  const annotations: Record<string, any> = {};
  if (!isOn(inputs.enabled, "crossovers")) return annotations;
  inputs.crossovers.forEach((c, idx) => {
    annotations[`crossover-${idx}`] = {
      type: "point",
      xValue: toTimestamp(c.date),
      yValue: c.price,
      backgroundColor: c.type === "golden-cross" ? "rgba(234, 179, 8, 0.9)" : "rgba(15, 23, 42, 0.9)",
      radius: 6,
      borderWidth: 1,
      borderColor: "white",
      label: {
        display: true,
        content: c.type === "golden-cross" ? "Golden Cross" : "Death Cross",
        position: "end",
        yAdjust: c.type === "golden-cross" ? -14 : 14,
        font: { size: 9 },
        backgroundColor: c.type === "golden-cross" ? "rgba(234, 179, 8, 0.9)" : "rgba(15, 23, 42, 0.9)",
        color: "white",
      },
    };
  });
  return annotations;
}

function fibonacciAnnotations(inputs: ChartInputs) {
  const annotations: Record<string, any> = {};
  if (!isOn(inputs.enabled, "fibonacci")) return annotations;
  // Fibonacci levels are famous mainly for the middle ones (23.6/38.2/50/
  // 61.8/78.6%) — 0% and 100% are just the range's high/low, already shown
  // elsewhere, so we skip drawing those two to keep the chart readable.
  const colors: Record<number, string> = {
    0.236: "rgba(59, 130, 246, 0.7)",
    0.382: "rgba(16, 185, 129, 0.7)",
    0.5: "rgba(234, 179, 8, 0.8)",
    0.618: "rgba(249, 115, 22, 0.8)",
    0.786: "rgba(239, 68, 68, 0.7)",
  };
  inputs.fibLevels.forEach((level) => {
    if (level.pct === 0 || level.pct === 1) return;
    const color = colors[level.pct] ?? "rgba(107, 114, 128, 0.6)";
    annotations[`fib-${level.pct}`] = {
      type: "line",
      yMin: level.price,
      yMax: level.price,
      borderColor: color,
      borderWidth: 1,
      borderDash: [3, 3],
      label: {
        display: true,
        content: `Fib ${(level.pct * 100).toFixed(1)}% (${level.price.toFixed(2)})`,
        position: "end",
        font: { size: 8 },
        backgroundColor: color,
        color: "white",
      },
    };
  });
  return annotations;
}

async function renderPricePanel(inputs: ChartInputs): Promise<Buffer> {
  const { candles, sma50, sma200, bollingerUpper, bollingerMiddle, bollingerLower, support, resistance, enabled, ichimoku } = inputs;
  const timestamps = candles.map((c) => toTimestamp(c.date));

  // toXY pairs a value series with its matching timestamps, dropping
  // nulls (Chart.js's time scale is happier with sparse {x,y} points than
  // an array of nulls aligned by index, which is what our category-axis
  // panels use instead).
  function toXY(values: (number | null)[], ts: number[] = timestamps) {
    return values.map((v, i) => (v === null ? null : { x: ts[i], y: v })).filter((p) => p !== null);
  }

  const datasets: any[] = [
    {
      type: "candlestick",
      label: "Price (OHLC)",
      data: candles.map((c, i) => ({ x: timestamps[i], o: c.open, h: c.high, l: c.low, c: c.close })),
    },
  ];
  if (isOn(enabled, "sma50")) {
    datasets.push({ type: "line", label: "SMA 50", data: toXY(sma50), borderColor: "rgb(234, 88, 12)", borderWidth: 1.5, pointRadius: 0, borderDash: [4, 4] });
  }
  if (isOn(enabled, "sma200")) {
    datasets.push({ type: "line", label: "SMA 200", data: toXY(sma200), borderColor: "rgb(220, 38, 38)", borderWidth: 1.5, pointRadius: 0, borderDash: [2, 2] });
  }
  if (isOn(enabled, "bollinger")) {
    datasets.push(
      { type: "line", label: "Bollinger Upper", data: toXY(bollingerUpper), borderColor: "rgba(107, 114, 128, 0.6)", borderWidth: 1, pointRadius: 0 },
      { type: "line", label: "Bollinger Middle (SMA 20)", data: toXY(bollingerMiddle), borderColor: "rgba(107, 114, 128, 0.4)", borderWidth: 1, borderDash: [2, 2], pointRadius: 0 },
      { type: "line", label: "Bollinger Lower", data: toXY(bollingerLower), borderColor: "rgba(107, 114, 128, 0.6)", borderWidth: 1, pointRadius: 0 }
    );
  }
  if (isOn(enabled, "ichimoku")) {
    const extended = timestamps.concat(extendTimestamps(candles, ichimoku.displacement));
    datasets.push(
      { type: "line", label: "Tenkan-sen (9)", data: toXY(ichimoku.tenkanSen), borderColor: "rgba(220, 38, 38, 0.8)", borderWidth: 1, pointRadius: 0 },
      { type: "line", label: "Kijun-sen (26)", data: toXY(ichimoku.kijunSen), borderColor: "rgba(37, 99, 235, 0.8)", borderWidth: 1, pointRadius: 0 },
      // Senkou Span A/B form the "cloud" — filling between them via
      // Chart.js's relative fill ("-1" = fill to the previous dataset).
      // A single translucent color is used for simplicity rather than the
      // traditional green-above/red-below split, which needs per-segment
      // coloring — worth revisiting if you want the classic look.
      { type: "line", label: "Senkou Span B", data: toXY(ichimoku.senkouB, extended), borderColor: "rgba(107, 114, 128, 0.3)", borderWidth: 1, pointRadius: 0, fill: false },
      { type: "line", label: "Senkou Span A (cloud)", data: toXY(ichimoku.senkouA, extended), borderColor: "rgba(107, 114, 128, 0.3)", borderWidth: 1, pointRadius: 0, fill: "-1", backgroundColor: "rgba(59, 130, 246, 0.15)" },
      { type: "line", label: "Chikou Span", data: toXY(ichimoku.chikouSpan), borderColor: "rgba(16, 185, 129, 0.7)", borderWidth: 1, pointRadius: 0 }
    );
  }

  const annotations: Record<string, any> = { ...crossoverAnnotations(inputs), ...fibonacciAnnotations(inputs) };
  if (isOn(enabled, "supportResistance")) {
    annotations.support = {
      type: "line",
      yMin: support,
      yMax: support,
      borderColor: "rgb(22, 163, 74)",
      borderWidth: 1.5,
      borderDash: [6, 4],
      label: { display: true, content: `Support ${support.toFixed(2)}`, position: "start", font: { size: 9 }, backgroundColor: "rgba(22, 163, 74, 0.85)", color: "white" },
    };
    annotations.resistance = {
      type: "line",
      yMin: resistance,
      yMax: resistance,
      borderColor: "rgb(220, 38, 38)",
      borderWidth: 1.5,
      borderDash: [6, 4],
      label: { display: true, content: `Resistance ${resistance.toFixed(2)}`, position: "start", font: { size: 9 }, backgroundColor: "rgba(220, 38, 38, 0.85)", color: "white" },
    };
  }

  const configuration = {
    data: { datasets },
    options: {
      plugins: {
        legend: { display: true, position: "top" as const, labels: { boxWidth: 12, font: { size: 9 } } },
        title: { display: true, text: "Price (candlesticks) with selected indicators & patterns" },
        annotation: { annotations },
      },
      scales: {
        x: {
          type: "linear" as const,
          ticks: {
            font: { size: 9 },
            maxTicksLimit: 10,
            // Timestamps in, "YYYY-MM-DD" out — see the note above on why
            // we do this by hand instead of using Chart.js's date adapter.
            callback: (value: number) => new Date(value).toISOString().slice(0, 10),
          },
        },
        y: { ticks: { font: { size: 9 } } },
      },
    },
  };

  return (await getChartCanvas()).renderToBuffer(configuration as any);
}

async function renderRsiPanel(inputs: ChartInputs): Promise<Buffer> {
  const labels = inputs.candles.map((c) => c.date);
  const configuration = {
    type: "line" as const,
    data: {
      labels,
      datasets: [{ label: "RSI (14)", data: inputs.rsiSeries, borderColor: "rgb(124, 58, 237)", borderWidth: 1.5, pointRadius: 0 }],
    },
    options: {
      plugins: {
        legend: { display: true, position: "top" as const, labels: { boxWidth: 12, font: { size: 10 } } },
        title: { display: true, text: "RSI (14) — above 70 = overbought, below 30 = oversold" },
        annotation: {
          annotations: {
            overbought: { type: "line", yMin: 70, yMax: 70, borderColor: "rgba(220, 38, 38, 0.6)", borderWidth: 1, borderDash: [4, 4] },
            oversold: { type: "line", yMin: 30, yMax: 30, borderColor: "rgba(22, 163, 74, 0.6)", borderWidth: 1, borderDash: [4, 4] },
          },
        },
      },
      scales: {
        y: { min: 0, max: 100, ticks: { font: { size: 9 } } },
        x: { ticks: { maxTicksLimit: 10, font: { size: 9 } } },
      },
    },
  };
  return (await getChartCanvas()).renderToBuffer(configuration as any);
}

async function renderStochasticPanel(inputs: ChartInputs): Promise<Buffer> {
  const labels = inputs.candles.map((c) => c.date);
  const configuration = {
    type: "line" as const,
    data: {
      labels,
      datasets: [
        { label: "%K", data: inputs.stochasticK, borderColor: "rgb(37, 99, 235)", borderWidth: 1.5, pointRadius: 0 },
        { label: "%D (signal)", data: inputs.stochasticD, borderColor: "rgb(234, 88, 12)", borderWidth: 1.5, pointRadius: 0 },
      ],
    },
    options: {
      plugins: {
        legend: { display: true, position: "top" as const, labels: { boxWidth: 12, font: { size: 10 } } },
        title: { display: true, text: "Stochastic Oscillator (14, 3, 3) — above 80 = overbought, below 20 = oversold" },
        annotation: {
          annotations: {
            overbought: { type: "line", yMin: 80, yMax: 80, borderColor: "rgba(220, 38, 38, 0.6)", borderWidth: 1, borderDash: [4, 4] },
            oversold: { type: "line", yMin: 20, yMax: 20, borderColor: "rgba(22, 163, 74, 0.6)", borderWidth: 1, borderDash: [4, 4] },
          },
        },
      },
      scales: {
        y: { min: 0, max: 100, ticks: { font: { size: 9 } } },
        x: { ticks: { maxTicksLimit: 10, font: { size: 9 } } },
      },
    },
  };
  return (await getChartCanvas()).renderToBuffer(configuration as any);
}

async function renderAdxPanel(inputs: ChartInputs): Promise<Buffer> {
  const labels = inputs.candles.map((c) => c.date);
  const configuration = {
    type: "line" as const,
    data: {
      labels,
      datasets: [
        { label: "ADX", data: inputs.adxLine, borderColor: "rgb(15, 23, 42)", borderWidth: 2, pointRadius: 0 },
        { label: "+DI", data: inputs.plusDI, borderColor: "rgb(22, 163, 74)", borderWidth: 1.5, pointRadius: 0 },
        { label: "-DI", data: inputs.minusDI, borderColor: "rgb(220, 38, 38)", borderWidth: 1.5, pointRadius: 0 },
      ],
    },
    options: {
      plugins: {
        legend: { display: true, position: "top" as const, labels: { boxWidth: 12, font: { size: 10 } } },
        title: { display: true, text: "ADX (14) — above 25 suggests a real trend; +DI vs -DI shows which direction" },
        annotation: {
          annotations: {
            trending: { type: "line", yMin: 25, yMax: 25, borderColor: "rgba(107, 114, 128, 0.6)", borderWidth: 1, borderDash: [4, 4] },
          },
        },
      },
      scales: {
        y: { min: 0, ticks: { font: { size: 9 } } },
        x: { ticks: { maxTicksLimit: 10, font: { size: 9 } } },
      },
    },
  };
  return (await getChartCanvas()).renderToBuffer(configuration as any);
}

async function renderMacdPanel(inputs: ChartInputs): Promise<Buffer> {
  const labels = inputs.candles.map((c) => c.date);
  const configuration = {
    type: "bar" as const,
    data: {
      labels,
      datasets: [
        {
          type: "bar" as const,
          label: "Histogram",
          data: inputs.macdHistogram,
          backgroundColor: (ctx: any) => {
            const v = ctx.raw;
            return v >= 0 ? "rgba(22, 163, 74, 0.6)" : "rgba(220, 38, 38, 0.6)";
          },
        },
        { type: "line" as const, label: "MACD line", data: inputs.macdLine, borderColor: "rgb(37, 99, 235)", borderWidth: 1.5, pointRadius: 0 },
        { type: "line" as const, label: "Signal line", data: inputs.macdSignal, borderColor: "rgb(234, 88, 12)", borderWidth: 1.5, pointRadius: 0 },
      ],
    },
    options: {
      plugins: {
        legend: { display: true, position: "top" as const, labels: { boxWidth: 12, font: { size: 10 } } },
        title: { display: true, text: "MACD (12, 26, 9) — line/signal crossovers & histogram momentum" },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 10, font: { size: 9 } } },
        y: { ticks: { font: { size: 9 } } },
      },
    },
  };
  return (await getChartCanvas()).renderToBuffer(configuration as any);
}
