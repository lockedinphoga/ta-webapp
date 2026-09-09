// lib/indicators.ts
//
// This file computes technical indicators from raw price data.
// Each function is a plain-math implementation (no external TA library),
// so you can see exactly what's being calculated. Comments explain WHAT
// each indicator measures and WHY traders use it, per the project's
// "explain everything" rule.

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// --- Simple Moving Average (SMA) ---
// What it measures: the average closing price over the last N days.
// Why it matters: smooths out day-to-day noise so you can see the
// underlying trend. A common beginner signal: price above its SMA-50 or
// SMA-200 is often read as a bullish (uptrend) sign, and vice versa.
export function sma(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// --- Exponential Moving Average (EMA) ---
// What it measures: like SMA, but weights recent prices more heavily, so
// it reacts faster to new price action. Used on its own, and as a
// building block for MACD (below).
export function ema(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  const k = 2 / (period + 1);
  let prevEma: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    if (i === period - 1) {
      // seed the first EMA value with a simple average
      const seed = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
      prevEma = seed;
      out[i] = seed;
    } else if (i >= period && prevEma !== null) {
      const val: number = closes[i] * k + (prevEma as number) * (1 - k);
      out[i] = val;
      prevEma = val;
    }
  }
  return out;
}

// --- Relative Strength Index (RSI-14, the standard period) ---
// What it measures: the speed/magnitude of recent price changes, scaled
// 0-100. Traditionally: RSI > 70 = "overbought" (may be due for a pullback),
// RSI < 30 = "oversold" (may be due for a bounce). It's a momentum
// indicator, not a guarantee — strong trends can stay "overbought" a long time.
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= period) {
      gainSum += gain;
      lossSum += loss;
      if (i === period) {
        const avgGain = gainSum / period;
        const avgLoss = lossSum / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
        (out as any)._avgGain = avgGain;
        (out as any)._avgLoss = avgLoss;
      }
    } else {
      // Wilder's smoothing: blends the previous average with today's value
      const prevAvgGain = (out as any)._avgGain;
      const prevAvgLoss = (out as any)._avgLoss;
      const avgGain = (prevAvgGain * (period - 1) + gain) / period;
      const avgLoss = (prevAvgLoss * (period - 1) + loss) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      (out as any)._avgGain = avgGain;
      (out as any)._avgLoss = avgLoss;
    }
  }
  return out;
}

// --- MACD (12, 26, 9 — the standard settings) ---
// What it measures: the difference between a fast EMA (12-day) and a slow
// EMA (26-day), called the "MACD line." A 9-day EMA of that line is the
// "signal line." Why it matters: when the MACD line crosses above the
// signal line, it's often read as bullish momentum building; crossing
// below is often read as bearish. The "histogram" (MACD line minus signal
// line) shows how strong that momentum is.
export function macd(closes: number[]) {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine: (number | null)[] = closes.map((_, i) =>
    ema12[i] !== null && ema26[i] !== null ? (ema12[i] as number) - (ema26[i] as number) : null
  );
  // signal line = 9-day EMA of the MACD line (only over the non-null part)
  const firstValid = macdLine.findIndex((v) => v !== null);
  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  if (firstValid !== -1) {
    const validSeries = macdLine.slice(firstValid).map((v) => v as number);
    const signalEma = ema(validSeries, 9);
    signalEma.forEach((v, idx) => {
      signalLine[firstValid + idx] = v;
    });
  }
  const histogram: (number | null)[] = closes.map((_, i) =>
    macdLine[i] !== null && signalLine[i] !== null ? (macdLine[i] as number) - (signalLine[i] as number) : null
  );
  return { macdLine, signalLine, histogram };
}

// --- Bollinger Bands (20-period, 2 standard deviations — the standard settings) ---
// What it measures: a middle band (SMA-20) plus an upper/lower band drawn
// 2 standard deviations away from it. Why it matters: the bands widen when
// price is volatile and squeeze together when it's calm. Price touching or
// poking outside the upper band is often read as "stretched" to the
// upside (possible pullback); touching the lower band, "stretched" to the
// downside. A tight squeeze is often watched as a sign a big move is coming.
export function bollingerBands(closes: number[], period = 20, numStdDev = 2) {
  const middle = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const window = closes.slice(i - period + 1, i + 1);
    const mean = middle[i] as number;
    const variance = window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    upper[i] = mean + numStdDev * stdDev;
    lower[i] = mean - numStdDev * stdDev;
  }
  return { middle, upper, lower };
}

// --- Golden Cross / Death Cross detection ---
// What it measures: the moment the SMA-50 crosses the SMA-200. Why it
// matters: a "golden cross" (50 crossing ABOVE 200) is one of the most
// widely-watched bullish long-term signals; a "death cross" (50 crossing
// BELOW 200) is the bearish counterpart. We scan the whole series and
// return every crossover point so it can be marked on the chart.
export function findMovingAverageCrossovers(
  candles: Candle[],
  sma50: (number | null)[],
  sma200: (number | null)[]
): { date: string; index: number; type: "golden-cross" | "death-cross"; price: number }[] {
  const crossovers: { date: string; index: number; type: "golden-cross" | "death-cross"; price: number }[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev50 = sma50[i - 1];
    const prev200 = sma200[i - 1];
    const cur50 = sma50[i];
    const cur200 = sma200[i];
    if (prev50 === null || prev200 === null || cur50 === null || cur200 === null) continue;
    if (prev50 <= prev200 && cur50 > cur200) {
      crossovers.push({ date: candles[i].date, index: i, type: "golden-cross", price: candles[i].close });
    } else if (prev50 >= prev200 && cur50 < cur200) {
      crossovers.push({ date: candles[i].date, index: i, type: "death-cross", price: candles[i].close });
    }
  }
  return crossovers;
}

// --- Average True Range (ATR-14, the standard period) ---
// What it measures: the average size of a stock's daily price swings
// (accounting for gaps between days, not just high-low). Why it matters:
// unlike RSI/MACD, ATR doesn't say "up" or "down" — it says how BIG a
// typical move is. Traders commonly use it to size stop-losses (e.g.
// "1.5x ATR below entry") so a stop is wide enough to survive normal
// noise but tight enough to limit damage if wrong. Higher ATR = more
// volatile = wider stops needed.
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const trueRanges: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  // Wilder's smoothing — the same technique RSI uses (see above): seed
  // with a simple average, then blend each new value in gradually.
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let avg: number | null = null;
  for (let i = 0; i < trueRanges.length; i++) {
    if (i === period - 1) {
      avg = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
      out[i] = avg;
    } else if (i >= period && avg !== null) {
      avg = (avg * (period - 1) + trueRanges[i]) / period;
      out[i] = avg;
    }
  }
  return out;
}

// --- Standard Deviation (20-period, standalone) ---
// What it measures: how spread out closing prices have been over the last
// N days — the same statistic Bollinger Bands are built from (above), but
// exposed on its own since it's a useful volatility number by itself. A
// rising standard deviation means price is swinging more; a falling one
// means it's calming down.
export function standardDeviation(closes: number[], period = 20): (number | null)[] {
  const means = sma(closes, period);
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const window = closes.slice(i - period + 1, i + 1);
    const mean = means[i] as number;
    const variance = window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    out[i] = Math.sqrt(variance);
  }
  return out;
}

// --- Stochastic Oscillator (14, 3, 3 — the standard "slow stochastic" settings) ---
// What it measures: where today's close sits within the recent high-low
// range, scaled 0-100. Conceptually similar to RSI (a momentum/overbought-
// oversold gauge) but built differently — RSI looks at the SIZE of recent
// gains/losses, while Stochastic looks at WHERE price is within its recent
// range. %K is the raw reading; %D is a smoothed (3-day SMA) version of %K
// used as a signal line. Traditionally: above 80 = overbought, below 20 =
// oversold, and a %K/%D crossover is watched like a MACD crossover.
export function stochasticOscillator(candles: Candle[], kPeriod = 14, smoothK = 3, dPeriod = 3) {
  const rawK: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const window = candles.slice(i - kPeriod + 1, i + 1);
    const highestHigh = Math.max(...window.map((c) => c.high));
    const lowestLow = Math.min(...window.map((c) => c.low));
    const range = highestHigh - lowestLow;
    rawK[i] = range === 0 ? 50 : (100 * (candles[i].close - lowestLow)) / range;
  }
  // "Slow" stochastic smooths the raw %K with a short SMA before using it.
  const validRawK = rawK.filter((v): v is number => v !== null);
  const firstValid = rawK.findIndex((v) => v !== null);
  const smoothedK: (number | null)[] = new Array(candles.length).fill(null);
  if (firstValid !== -1) {
    const smoothed = sma(validRawK, smoothK);
    smoothed.forEach((v, idx) => (smoothedK[firstValid + idx] = v));
  }
  const validK = smoothedK.filter((v): v is number => v !== null);
  const firstValidK = smoothedK.findIndex((v) => v !== null);
  const percentD: (number | null)[] = new Array(candles.length).fill(null);
  if (firstValidK !== -1) {
    const d = sma(validK, dPeriod);
    d.forEach((v, idx) => (percentD[firstValidK + idx] = v));
  }
  return { percentK: smoothedK, percentD };
}

// --- ADX / Average Directional Index (14 — the standard period) ---
// What it measures: TREND STRENGTH, not direction. It's built from +DI and
// -DI (how much of the recent movement was upward vs. downward). Why it
// matters: ADX above 25 is commonly read as "there's a real trend here"
// (in either direction); below 20, "this is choppy/sideways, trend-
// following indicators like MACD are less reliable right now." +DI above
// -DI suggests bulls are in control; -DI above +DI suggests bears are.
export function adx(candles: Candle[], period = 14) {
  const n = candles.length;
  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);
  const trueRanges: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    const prevClose = candles[i - 1].close;
    trueRanges[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose)
    );
  }

  // Wilder-smooth all three raw series the same way ATR/RSI do above.
  function wilderSmooth(values: number[]): (number | null)[] {
    const out: (number | null)[] = new Array(n).fill(null);
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += values[i] ?? 0;
    let avg = sum / period;
    out[period] = avg;
    for (let i = period + 1; i < n; i++) {
      avg = avg - avg / period + values[i];
      out[i] = avg;
    }
    return out;
  }

  const smoothedTR = wilderSmooth(trueRanges);
  const smoothedPlusDM = wilderSmooth(plusDM);
  const smoothedMinusDM = wilderSmooth(minusDM);

  const plusDI: (number | null)[] = new Array(n).fill(null);
  const minusDI: (number | null)[] = new Array(n).fill(null);
  const dx: (number | null)[] = new Array(n).fill(null);

  for (let i = period; i < n; i++) {
    const tr = smoothedTR[i];
    if (tr === null || tr === 0) continue;
    const pDI = (100 * (smoothedPlusDM[i] as number)) / tr;
    const mDI = (100 * (smoothedMinusDM[i] as number)) / tr;
    plusDI[i] = pDI;
    minusDI[i] = mDI;
    const diSum = pDI + mDI;
    dx[i] = diSum === 0 ? 0 : (100 * Math.abs(pDI - mDI)) / diSum;
  }

  // ADX itself is a smoothed average of DX.
  const firstDx = dx.findIndex((v) => v !== null);
  const adxLine: (number | null)[] = new Array(n).fill(null);
  if (firstDx !== -1 && firstDx + period < n) {
    const validDx = dx.slice(firstDx).map((v) => v as number);
    let sum = 0;
    for (let i = 0; i < period; i++) sum += validDx[i];
    let avg = sum / period;
    adxLine[firstDx + period - 1] = avg;
    for (let i = period; i < validDx.length; i++) {
      avg = (avg * (period - 1) + validDx[i]) / period;
      adxLine[firstDx + i] = avg;
    }
  }

  return { adx: adxLine, plusDI, minusDI };
}

// --- Fibonacci Retracement ---
// What it measures: nothing computed from price behavior directly —
// instead, it takes the highest high and lowest low over a lookback
// window and marks specific percentage levels between them (23.6%, 38.2%,
// 50%, 61.8%, 78.6%). Why it matters: many traders watch these levels as
// possible support/resistance during a pullback, on the theory that
// retracements often stall near these ratios (derived from the Fibonacci
// sequence). This is a real widely-used tool, but treat it with extra
// skepticism — unlike RSI/MACD/etc. there's no underlying math tying
// price behavior to these specific percentages, only trader convention.
export function fibonacciRetracement(candles: Candle[], lookback = 60) {
  const recent = candles.slice(-Math.min(lookback, candles.length));
  const highest = Math.max(...recent.map((c) => c.high));
  const lowest = Math.min(...recent.map((c) => c.low));
  const range = highest - lowest;
  const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((pct) => ({
    pct,
    price: highest - range * pct, // measuring the retracement DOWN from the recent high
  }));
  return { high: highest, low: lowest, levels };
}

// --- Ichimoku Cloud (9, 26, 52 — the standard settings) ---
// What it measures: a multi-part trend/support-resistance system, all
// derived from simple high/low midpoints:
//  - Tenkan-sen ("conversion line", 9-period): short-term momentum
//  - Kijun-sen ("base line", 26-period): medium-term trend/support-resistance
//  - Senkou Span A/B ("leading spans"): plotted 26 days AHEAD of today,
//    forming the shaded "cloud" — price above the cloud = uptrend bias,
//    below = downtrend bias, and the cloud itself acts as dynamic
//    support/resistance
//  - Chikou Span ("lagging span"): today's close plotted 26 days BEHIND
// This is the most complex indicator here — it's a full system some
// traders use on its own, not just one signal among many.
export function ichimokuCloud(candles: Candle[]) {
  const n = candles.length;
  const displacement = 26;

  function midpoint(period: number): (number | null)[] {
    const out: (number | null)[] = new Array(n).fill(null);
    for (let i = period - 1; i < n; i++) {
      const window = candles.slice(i - period + 1, i + 1);
      const hi = Math.max(...window.map((c) => c.high));
      const lo = Math.min(...window.map((c) => c.low));
      out[i] = (hi + lo) / 2;
    }
    return out;
  }

  const tenkanSen = midpoint(9);
  const kijunSen = midpoint(26);
  const spanBRaw = midpoint(52);

  // Senkou Span A/B are plotted `displacement` periods into the FUTURE
  // relative to the data they're computed from, so we build arrays that
  // extend past the end of the known candles.
  const senkouA: (number | null)[] = new Array(n + displacement).fill(null);
  const senkouB: (number | null)[] = new Array(n + displacement).fill(null);
  for (let i = 0; i < n; i++) {
    if (tenkanSen[i] !== null && kijunSen[i] !== null) {
      senkouA[i + displacement] = ((tenkanSen[i] as number) + (kijunSen[i] as number)) / 2;
    }
    if (spanBRaw[i] !== null) {
      senkouB[i + displacement] = spanBRaw[i];
    }
  }

  // Chikou Span is today's close plotted `displacement` periods into the PAST.
  const chikouSpan: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i - displacement >= 0) {
      chikouSpan[i - displacement] = candles[i].close;
    }
  }

  return { tenkanSen, kijunSen, senkouA, senkouB, chikouSpan, displacement };
}

// --- Simple support/resistance ---
// What it measures: recent swing highs and lows. Why it matters: price
// has often "bounced" off these levels before, so traders watch them as
// potential turning points. This is a simplified heuristic (looking at
// the highest high / lowest low over a lookback window), not true
// pivot-point detection — good enough for a first pass, worth refining later.
export function supportResistance(candles: Candle[], lookback = 20) {
  const recent = candles.slice(-lookback);
  const resistance = Math.max(...recent.map((c) => c.high));
  const support = Math.min(...recent.map((c) => c.low));
  return { support, resistance };
}

// Bundles the latest value of every indicator into one plain-English-ready
// summary object, so we don't send the AI 200 rows of raw arrays.
export function summarizeIndicators(candles: Candle[]) {
  const closes = candles.map((c) => c.close);
  const rsiSeries = rsi(closes, 14);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const { macdLine, signalLine, histogram } = macd(closes);
  const { support, resistance } = supportResistance(candles, 20);
  const bands = bollingerBands(closes, 20, 2);
  const crossovers = findMovingAverageCrossovers(candles, sma50, sma200);
  const atrSeries = atr(candles, 14);
  const stdDevSeries = standardDeviation(closes, 20);
  const { percentK, percentD } = stochasticOscillator(candles);
  const { adx: adxLine, plusDI, minusDI } = adx(candles, 14);
  const fib = fibonacciRetracement(candles, 60);
  const last = closes.length - 1;

  return {
    lastClose: closes[last],
    rsi14: rsiSeries[last],
    sma50: sma50[last],
    sma200: sma200[last],
    macd: macdLine[last],
    macdSignal: signalLine[last],
    macdHistogram: histogram[last],
    support,
    resistance,
    priceVsSma50: sma50[last] !== null ? closes[last] - (sma50[last] as number) : null,
    priceVsSma200: sma200[last] !== null ? closes[last] - (sma200[last] as number) : null,
    bollingerUpper: bands.upper[last],
    bollingerMiddle: bands.middle[last],
    bollingerLower: bands.lower[last],
    recentCrossovers: crossovers.slice(-3), // most recent golden/death crosses, if any
    atr14: atrSeries[last],
    stdDev20: stdDevSeries[last],
    stochasticK: percentK[last],
    stochasticD: percentD[last],
    adx14: adxLine[last],
    plusDI14: plusDI[last],
    minusDI14: minusDI[last],
    fibonacci: fib,
  };
}
