/**
 * Pure indicator math for the Live Charts dashboard.
 * All functions take ascending-time OHLCV candles and return arrays
 * aligned to the same time axis (or summary values).
 *
 * Time is unix-seconds (UTCTimestamp from lightweight-charts).
 */

import type { LiveCandle } from "./liveSources";

export interface LinePoint { time: number; value: number; }
export interface HistPoint { time: number; value: number; color?: string; }
export interface FVGZone   { time: number; top: number; bottom: number; kind: "bull" | "bear"; }
export interface VPInfo    { poc: number; vah: number; val: number; }

// ---------- helpers ----------
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);

function sma(values: number[], n: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < n) return out;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += values[i];
  out[n - 1] = acc / n;
  for (let i = n; i < values.length; i++) {
    acc += values[i] - values[i - n];
    out[i] = acc / n;
  }
  return out;
}

function ema(values: number[], n: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = mean(values.slice(0, n));
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Wilder smoothing (used by RSI / ATR / ADX)
function wilder(values: number[], n: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < n) return out;
  let prev = sum(values.slice(0, n)) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = (prev * (n - 1) + values[i]) / n;
    out[i] = prev;
  }
  return out;
}

function stdev(values: number[], n: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < n) return out;
  for (let i = n - 1; i < values.length; i++) {
    const slice = values.slice(i - n + 1, i + 1);
    const m = mean(slice);
    out[i] = Math.sqrt(mean(slice.map(v => (v - m) ** 2)));
  }
  return out;
}

// ---------- TREND / OVERLAYS ----------
export function calcSMA(candles: LiveCandle[], n = 20): LinePoint[] {
  const xs = sma(candles.map(c => c.close), n);
  return candles.map((c, i) => ({ time: c.time, value: xs[i] })).filter(p => !Number.isNaN(p.value));
}

export function calcEMA(candles: LiveCandle[], n = 20): LinePoint[] {
  const xs = ema(candles.map(c => c.close), n);
  return candles.map((c, i) => ({ time: c.time, value: xs[i] })).filter(p => !Number.isNaN(p.value));
}

export function calcBollinger(candles: LiveCandle[], n = 20, mult = 2):
  { upper: LinePoint[]; middle: LinePoint[]; lower: LinePoint[] } {
  const closes = candles.map(c => c.close);
  const mid = sma(closes, n);
  const sd  = stdev(closes, n);
  const u: LinePoint[] = [], m: LinePoint[] = [], l: LinePoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(mid[i])) continue;
    u.push({ time: candles[i].time, value: mid[i] + mult * sd[i] });
    m.push({ time: candles[i].time, value: mid[i] });
    l.push({ time: candles[i].time, value: mid[i] - mult * sd[i] });
  }
  return { upper: u, middle: m, lower: l };
}

function trueRangeSeries(candles: LiveCandle[]): number[] {
  const tr: number[] = new Array(candles.length).fill(NaN);
  if (!candles.length) return tr;
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  return tr;
}

export function calcATR(candles: LiveCandle[], n = 14): LinePoint[] {
  const tr = trueRangeSeries(candles);
  const xs = wilder(tr, n);
  return candles.map((c, i) => ({ time: c.time, value: xs[i] })).filter(p => !Number.isNaN(p.value));
}

export function calcSupertrend(candles: LiveCandle[], period = 10, mult = 3): LinePoint[] {
  if (candles.length < period + 1) return [];
  const tr = trueRangeSeries(candles);
  const atr = wilder(tr, period);
  const out: LinePoint[] = [];
  let prevUpper = 0, prevLower = 0, prevST = 0;
  let prevTrendUp: boolean = true;
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(atr[i])) continue;
    const c = candles[i];
    const hl2 = (c.high + c.low) / 2;
    let upperBand = hl2 + mult * atr[i];
    let lowerBand = hl2 - mult * atr[i];
    if (i > 0) {
      if (upperBand > prevUpper && candles[i - 1].close <= prevUpper) upperBand = prevUpper;
      if (lowerBand < prevLower && candles[i - 1].close >= prevLower) lowerBand = prevLower;
    }
    let trendUp: boolean = prevTrendUp;
    if (prevST !== 0) {
      if (prevTrendUp && c.close < prevLower) trendUp = false;
      else if (!prevTrendUp && c.close > prevUpper) trendUp = true;
    }
    const st = trendUp ? lowerBand : upperBand;
    out.push({ time: c.time, value: st });
    prevUpper = upperBand; prevLower = lowerBand; prevST = st; prevTrendUp = trendUp;
  }
  return out;
}

export function calcIchimoku(candles: LiveCandle[]):
  { tenkan: LinePoint[]; kijun: LinePoint[]; senkouA: LinePoint[]; senkouB: LinePoint[]; chikou: LinePoint[]; } {
  const tk = 9, kj = 26, sb = 52;
  const tenkan: LinePoint[] = [], kijun: LinePoint[] = [], senkouA: LinePoint[] = [],
        senkouB: LinePoint[] = [], chikou: LinePoint[] = [];
  function midHL(from: number, n: number): number {
    let hi = -Infinity, lo = Infinity;
    for (let j = from - n + 1; j <= from; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low  < lo) lo = candles[j].low;
    }
    return (hi + lo) / 2;
  }
  for (let i = 0; i < candles.length; i++) {
    const t = candles[i].time;
    if (i >= tk - 1) tenkan.push({ time: t, value: midHL(i, tk) });
    if (i >= kj - 1) kijun.push({ time: t, value: midHL(i, kj) });
    if (i >= sb - 1) senkouB.push({ time: t, value: midHL(i, sb) });
    if (i >= kj - 1) {
      const a = (midHL(i, tk) + midHL(i, kj)) / 2;
      senkouA.push({ time: t, value: a });
    }
  }
  // Chikou = close shifted 26 back (rendered on past bars)
  for (let i = kj; i < candles.length; i++) {
    chikou.push({ time: candles[i - kj].time, value: candles[i].close });
  }
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

export function calcPivotPoints(candles: LiveCandle[]):
  { pp: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number } | null {
  if (candles.length < 2) return null;
  const prev = candles[candles.length - 2];
  const pp = (prev.high + prev.low + prev.close) / 3;
  const r1 = 2 * pp - prev.low;
  const s1 = 2 * pp - prev.high;
  const r2 = pp + (prev.high - prev.low);
  const s2 = pp - (prev.high - prev.low);
  const r3 = prev.high + 2 * (pp - prev.low);
  const s3 = prev.low - 2 * (prev.high - pp);
  return { pp, r1, r2, r3, s1, s2, s3 };
}

export function calcFairValueGaps(candles: LiveCandle[]): FVGZone[] {
  // Classic 3-candle FVG: gap between candle[i-2] and candle[i] (skipping the middle).
  const out: FVGZone[] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2], c = candles[i];
    if (c.low > a.high) {                    // bullish FVG
      out.push({ time: candles[i - 1].time, top: c.low, bottom: a.high, kind: "bull" });
    } else if (c.high < a.low) {             // bearish FVG
      out.push({ time: candles[i - 1].time, top: a.low, bottom: c.high, kind: "bear" });
    }
  }
  return out.slice(-20);    // cap so the chart stays readable
}

export function calcVolumeProfile(candles: LiveCandle[], buckets = 24): VPInfo | null {
  if (!candles.length) return null;
  let hi = -Infinity, lo = Infinity;
  for (const c of candles) { if (c.high > hi) hi = c.high; if (c.low < lo) lo = c.low; }
  if (hi <= lo) return null;
  const step = (hi - lo) / buckets;
  const vol = new Array(buckets).fill(0);
  for (const c of candles) {
    const mid = (c.high + c.low) / 2;
    let b = Math.floor((mid - lo) / step);
    if (b >= buckets) b = buckets - 1;
    if (b < 0) b = 0;
    vol[b] += c.volume;
  }
  let pocIdx = 0;
  for (let i = 1; i < buckets; i++) if (vol[i] > vol[pocIdx]) pocIdx = i;
  const total = vol.reduce((a, b) => a + b, 0);
  const target = total * 0.7;
  let acc = vol[pocIdx], lo_i = pocIdx, hi_i = pocIdx;
  while (acc < target && (lo_i > 0 || hi_i < buckets - 1)) {
    const dn = lo_i > 0 ? vol[lo_i - 1] : -1;
    const up = hi_i < buckets - 1 ? vol[hi_i + 1] : -1;
    if (up >= dn) { hi_i++; acc += vol[hi_i]; }
    else          { lo_i--; acc += vol[lo_i]; }
  }
  return {
    poc: lo + (pocIdx + 0.5) * step,
    vah: lo + (hi_i + 1) * step,
    val: lo + lo_i * step,
  };
}

// ---------- VOLUME ----------
export function calcVolume(candles: LiveCandle[]): HistPoint[] {
  return candles.map(c => ({
    time: c.time,
    value: c.volume,
    color: c.close >= c.open ? "#22c55e80" : "#ef444480",
  }));
}

// ---------- OSCILLATORS ----------
export function calcRSI(candles: LiveCandle[], n = 14): LinePoint[] {
  const closes = candles.map(c => c.close);
  if (closes.length < n + 1) return [];
  const gains: number[] = [0], losses: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  const ag = wilder(gains, n), al = wilder(losses, n);
  const out: LinePoint[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (Number.isNaN(ag[i])) continue;
    const rs = al[i] === 0 ? 100 : ag[i] / al[i];
    out.push({ time: candles[i].time, value: 100 - 100 / (1 + rs) });
  }
  return out;
}

export function calcMACD(candles: LiveCandle[], fast = 12, slow = 26, signal = 9):
  { macd: LinePoint[]; signal: LinePoint[]; hist: HistPoint[]; } {
  const closes = candles.map(c => c.close);
  const ef = ema(closes, fast), es = ema(closes, slow);
  const macdLine: number[] = closes.map((_, i) => ef[i] - es[i]);
  const sigLine = ema(macdLine.map(v => Number.isNaN(v) ? 0 : v), signal);
  const macd: LinePoint[] = [], sig: LinePoint[] = [], hist: HistPoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(ef[i]) || Number.isNaN(es[i])) continue;
    macd.push({ time: candles[i].time, value: macdLine[i] });
    if (!Number.isNaN(sigLine[i])) {
      sig.push({ time: candles[i].time, value: sigLine[i] });
      const h = macdLine[i] - sigLine[i];
      hist.push({ time: candles[i].time, value: h, color: h >= 0 ? "#22c55e90" : "#ef444490" });
    }
  }
  return { macd, signal: sig, hist };
}

export function calcStochastic(candles: LiveCandle[], n = 14, kSmooth = 3, dSmooth = 3):
  { k: LinePoint[]; d: LinePoint[] } {
  const rawK: number[] = new Array(candles.length).fill(NaN);
  for (let i = n - 1; i < candles.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low  < lo) lo = candles[j].low;
    }
    rawK[i] = hi === lo ? 50 : ((candles[i].close - lo) / (hi - lo)) * 100;
  }
  const k = sma(rawK.map(v => Number.isNaN(v) ? 0 : v), kSmooth);
  const d = sma(k.map(v => Number.isNaN(v) ? 0 : v), dSmooth);
  const kOut: LinePoint[] = [], dOut: LinePoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i >= n - 1 + kSmooth - 1) kOut.push({ time: candles[i].time, value: k[i] });
    if (i >= n - 1 + kSmooth - 1 + dSmooth - 1) dOut.push({ time: candles[i].time, value: d[i] });
  }
  return { k: kOut, d: dOut };
}

export function calcADX(candles: LiveCandle[], n = 14):
  { adx: LinePoint[]; plusDI: LinePoint[]; minusDI: LinePoint[] } {
  if (candles.length < n + 1) return { adx: [], plusDI: [], minusDI: [] };
  const tr = trueRangeSeries(candles);
  const plusDM: number[] = [0], minusDM: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const dnMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > dnMove && upMove > 0 ? upMove : 0);
    minusDM.push(dnMove > upMove && dnMove > 0 ? dnMove : 0);
  }
  const trN = wilder(tr, n), pN = wilder(plusDM, n), mN = wilder(minusDM, n);
  const plusDI: LinePoint[] = [], minusDI: LinePoint[] = [];
  const dxArr: number[] = new Array(candles.length).fill(NaN);
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(trN[i]) || trN[i] === 0) continue;
    const p = (pN[i] / trN[i]) * 100;
    const m = (mN[i] / trN[i]) * 100;
    plusDI.push({ time: candles[i].time, value: p });
    minusDI.push({ time: candles[i].time, value: m });
    dxArr[i] = p + m === 0 ? 0 : (Math.abs(p - m) / (p + m)) * 100;
  }
  const adxArr = wilder(dxArr.map(v => Number.isNaN(v) ? 0 : v), n);
  const adx: LinePoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(adxArr[i])) continue;
    adx.push({ time: candles[i].time, value: adxArr[i] });
  }
  return { adx, plusDI, minusDI };
}

export function calcCCI(candles: LiveCandle[], n = 20): LinePoint[] {
  const tp = candles.map(c => (c.high + c.low + c.close) / 3);
  const m = sma(tp, n);
  const out: LinePoint[] = [];
  for (let i = n - 1; i < candles.length; i++) {
    const slice = tp.slice(i - n + 1, i + 1);
    const md = mean(slice.map(v => Math.abs(v - m[i])));
    if (md === 0) continue;
    out.push({ time: candles[i].time, value: (tp[i] - m[i]) / (0.015 * md) });
  }
  return out;
}

export function calcOBV(candles: LiveCandle[]): LinePoint[] {
  const out: LinePoint[] = [];
  let obv = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i > 0) {
      if      (candles[i].close > candles[i - 1].close) obv += candles[i].volume;
      else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume;
    }
    out.push({ time: candles[i].time, value: obv });
  }
  return out;
}

export function calcMFI(candles: LiveCandle[], n = 14): LinePoint[] {
  if (candles.length < n + 1) return [];
  const tp = candles.map(c => (c.high + c.low + c.close) / 3);
  const flow = candles.map((c, i) => tp[i] * c.volume);
  const pos: number[] = [0], neg: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    if (tp[i] > tp[i - 1])      { pos.push(flow[i]); neg.push(0); }
    else if (tp[i] < tp[i - 1]) { pos.push(0);       neg.push(flow[i]); }
    else                        { pos.push(0);       neg.push(0); }
  }
  const out: LinePoint[] = [];
  for (let i = n; i < candles.length; i++) {
    const pSum = sum(pos.slice(i - n + 1, i + 1));
    const nSum = sum(neg.slice(i - n + 1, i + 1));
    const mfi = nSum === 0 ? 100 : 100 - 100 / (1 + pSum / nSum);
    out.push({ time: candles[i].time, value: mfi });
  }
  return out;
}

export function calcWilliamsR(candles: LiveCandle[], n = 14): LinePoint[] {
  const out: LinePoint[] = [];
  for (let i = n - 1; i < candles.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low  < lo) lo = candles[j].low;
    }
    const v = hi === lo ? -50 : (-100 * (hi - candles[i].close)) / (hi - lo);
    out.push({ time: candles[i].time, value: v });
  }
  return out;
}
