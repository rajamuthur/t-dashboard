"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, LineChart } from "lucide-react";
import {
  createChart, ColorType, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers,
  IChartApi, UTCTimestamp, LineStyle,
} from "lightweight-charts";
import {
  calcSMA, calcEMA, calcBollinger, calcSupertrend, calcIchimoku, calcPivotPoints,
  calcFairValueGaps, calcVolumeProfile, calcVolume,
  calcRSI, calcMACD, calcStochastic, calcATR, calcADX, calcCCI, calcOBV, calcMFI, calcWilliamsR,
} from "@/lib/indicators";
import { INDICATOR_COLOR } from "@/lib/indicatorCatalog";
import IndicatorsPanel from "./IndicatorsPanel";

export interface PatternCandle {
  date: string; open: number; high: number; low: number; close: number; volume: number;
}
export interface PatternShape {
  type: "marker" | "hline" | "trendline" | "polyline";
  color?: string;
  label?: string;
  date?: string; price?: number; text?: string; position?: "aboveBar" | "belowBar";
  points?: { date: string; price: number }[];
}

interface Props {
  candles: PatternCandle[];
  shapes: PatternShape[];
  height?: number;
  // When set, the chart opens showing ~1 year around this date (the signal),
  // and the user can scroll left into earlier history (full data is loaded).
  focusDate?: string;
}

// Convert a stored candle/shape date to a lightweight-charts time (unix seconds).
// Unifies daily ('YYYY-MM-DD') and intraday ('YYYY-MM-DD HH:MM:SS') so candles,
// shapes and indicator series all share one time scale.
function toTime(d: string): UTCTimestamp {
  const t = Date.parse(d.includes(" ") ? d.replace(" ", "T") : d);
  return Math.floor(t / 1000) as UTCTimestamp;
}

export default function PatternShapeChart({ candles, shapes, height = 320, focusDate }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [fs, setFs] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());

  const intraday = useMemo(() => candles.some(c => c.date.includes(" ")), [candles]);

  // LiveCandle-shaped array (numeric time) for indicator math + candle series.
  const lc = useMemo(() => candles.map(c => ({
    time: toTime(c.date), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
  })), [candles]);

  useEffect(() => {
    function onFs() { setFs(!!document.fullscreenElement && document.fullscreenElement === wrapRef.current); }
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  async function toggleFullscreen() {
    const el = wrapRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch { /* ignore */ }
    setTimeout(() => {
      if (chartRef.current && ref.current) {
        chartRef.current.applyOptions({ width: ref.current.clientWidth, height: ref.current.clientHeight });
        chartRef.current.timeScale().fitContent();
      }
    }, 120);
  }

  function toggleIndicator(id: string) {
    setEnabled(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function setMany(ids: string[], on: boolean) {
    setEnabled(prev => { const n = new Set(prev); ids.forEach(i => on ? n.add(i) : n.delete(i)); return n; });
  }

  useEffect(() => {
    if (!ref.current || lc.length === 0) return;
    const chart: IChartApi = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#334155" },
      grid: { vertLines: { color: "#e2e8f0" }, horzLines: { color: "#e2e8f0" } },
      width: ref.current.clientWidth,
      height: fs ? window.innerHeight : height,
      timeScale: { borderColor: "#cbd5e1", timeVisible: intraday, secondsVisible: false },
      rightPriceScale: { borderColor: "#cbd5e1" },
      crosshair: { mode: 1 },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a", downColor: "#dc2626",
      borderUpColor: "#16a34a", borderDownColor: "#dc2626",
      wickUpColor: "#16a34a", wickDownColor: "#dc2626",
    });
    candleSeries.setData(lc.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })) as any);

    // ---- pattern geometry ----
    for (const s of shapes) {
      if ((s.type === "trendline" || s.type === "polyline") && s.points?.length) {
        const ls = chart.addSeries(LineSeries, {
          color: s.color ?? "#a855f7", lineWidth: 2,
          lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
        });
        const pts = [...s.points].sort((a, b) => (a.date < b.date ? -1 : 1));
        ls.setData(pts.map(p => ({ time: toTime(p.date), value: p.price })) as any);
      }
    }
    for (const s of shapes) {
      if (s.type === "hline" && s.price != null) {
        candleSeries.createPriceLine({
          price: s.price, color: s.color ?? "#64748b",
          lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: s.label ?? "",
        });
      }
    }
    const markers = shapes.filter(s => s.type === "marker" && s.date).map(s => ({
      time: toTime(s.date!), position: (s.position ?? "aboveBar") as "aboveBar" | "belowBar",
      color: s.color ?? "#334155", shape: "circle" as const, text: s.text ?? "",
    }));
    if (markers.length) createSeriesMarkers(candleSeries, markers as any);

    // ---- indicators ----
    let pane = 1;
    const line = (data: { time: number; value: number }[], color: string, paneIdx = 0, opts: any = {}) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, ...opts }, paneIdx);
      s.setData(data.map(d => ({ time: d.time as UTCTimestamp, value: d.value })) as any);
      return s;
    };
    const hist = (data: { time: number; value: number; color?: string }[], color: string, paneIdx: number, opts: any = {}) => {
      const s = chart.addSeries(HistogramSeries, { color, priceLineVisible: false, lastValueVisible: false, ...opts }, paneIdx);
      s.setData(data.map(d => ({ time: d.time as UTCTimestamp, value: d.value, color: d.color })) as any);
      return s;
    };
    for (const id of enabled) {
      switch (id) {
        case "sma20": line(calcSMA(lc, 20), INDICATOR_COLOR.sma20); break;
        case "ema50": line(calcEMA(lc, 50), INDICATOR_COLOR.ema50); break;
        case "bb": { const b = calcBollinger(lc, 20, 2); line(b.upper, INDICATOR_COLOR.bb_upper); line(b.middle, INDICATOR_COLOR.bb_mid, 0, { lineStyle: LineStyle.Dashed }); line(b.lower, INDICATOR_COLOR.bb_lower); break; }
        case "supertrend": line(calcSupertrend(lc, 10, 3), INDICATOR_COLOR.supertrend, 0, { lineWidth: 2 }); break;
        case "ichimoku": { const i = calcIchimoku(lc); line(i.tenkan, INDICATOR_COLOR.ichi_tenkan); line(i.kijun, INDICATOR_COLOR.ichi_kijun); line(i.senkouA, INDICATOR_COLOR.ichi_senkouA, 0, { lineStyle: LineStyle.Dotted }); line(i.senkouB, INDICATOR_COLOR.ichi_senkouB, 0, { lineStyle: LineStyle.Dotted }); line(i.chikou, INDICATOR_COLOR.ichi_chikou, 0, { lineStyle: LineStyle.Dashed }); break; }
        case "pivots": { const p = calcPivotPoints(lc); if (p) { for (const [v, c, t] of [[p.r3, INDICATOR_COLOR.pivot_r, "R3"], [p.r2, INDICATOR_COLOR.pivot_r, "R2"], [p.r1, INDICATOR_COLOR.pivot_r, "R1"], [p.pp, INDICATOR_COLOR.pivot_pp, "P"], [p.s1, INDICATOR_COLOR.pivot_s, "S1"], [p.s2, INDICATOR_COLOR.pivot_s, "S2"], [p.s3, INDICATOR_COLOR.pivot_s, "S3"]] as [number, string, string][]) candleSeries.createPriceLine({ price: v, color: c, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: t }); } break; }
        case "fvg": { for (const g of calcFairValueGaps(lc)) { const c = g.kind === "bull" ? INDICATOR_COLOR.fvg_bull : INDICATOR_COLOR.fvg_bear; candleSeries.createPriceLine({ price: g.top, color: c, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" }); candleSeries.createPriceLine({ price: g.bottom, color: c, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" }); } break; }
        case "vp": { const v = calcVolumeProfile(lc, 24); if (v) { candleSeries.createPriceLine({ price: v.poc, color: INDICATOR_COLOR.vp_poc, lineWidth: 2, axisLabelVisible: true, title: "POC" }); candleSeries.createPriceLine({ price: v.vah, color: INDICATOR_COLOR.vp_vah, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "VAH" }); candleSeries.createPriceLine({ price: v.val, color: INDICATOR_COLOR.vp_val, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "VAL" }); } break; }
        case "volume": hist(calcVolume(lc), "#64748b", pane++, { priceFormat: { type: "volume" } }); break;
        case "rsi": { const idx = pane++; const s = line(calcRSI(lc, 14), INDICATOR_COLOR.rsi, idx); s.createPriceLine({ price: 70, color: "#ef444480", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" }); s.createPriceLine({ price: 30, color: "#22c55e80", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" }); break; }
        case "macd": { const idx = pane++; const m = calcMACD(lc, 12, 26, 9); hist(m.hist, "#94a3b8", idx); line(m.macd, INDICATOR_COLOR.macd_line, idx); line(m.signal, INDICATOR_COLOR.macd_signal, idx); break; }
        case "stoch": { const idx = pane++; const s = calcStochastic(lc, 14, 3, 3); line(s.k, INDICATOR_COLOR.stoch_k, idx); line(s.d, INDICATOR_COLOR.stoch_d, idx); break; }
        case "atr": line(calcATR(lc, 14), INDICATOR_COLOR.atr, pane++); break;
        case "adx": { const idx = pane++; const a = calcADX(lc, 14); line(a.adx, INDICATOR_COLOR.adx, idx, { lineWidth: 2 }); line(a.plusDI, INDICATOR_COLOR.adx_plus, idx); line(a.minusDI, INDICATOR_COLOR.adx_minus, idx); break; }
        case "cci": line(calcCCI(lc, 20), INDICATOR_COLOR.cci, pane++); break;
        case "obv": line(calcOBV(lc), INDICATOR_COLOR.obv, pane++); break;
        case "mfi": line(calcMFI(lc, 14), INDICATOR_COLOR.mfi, pane++); break;
        case "williams": line(calcWilliamsR(lc, 14), INDICATOR_COLOR.williams, pane++); break;
      }
    }

    chartRef.current = chart;
    // Default view: ~1 year around the signal (scroll left for earlier years).
    // Falls back to fitting all data when no focus date is given.
    if (focusDate && lc.length) {
      const ft = toTime(focusDate);
      const YEAR = 365 * 24 * 3600;
      chart.timeScale().setVisibleRange({ from: (ft - YEAR) as any, to: (ft + 30 * 24 * 3600) as any });
    } else {
      chart.timeScale().fitContent();
    }
    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth, height: ref.current.clientHeight });
    });
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [lc, shapes, height, enabled, intraday, fs, focusDate]);

  if (candles.length === 0) {
    return <div className="flex items-center justify-center text-gray-500 bg-white rounded-lg" style={{ height }}>No candle data</div>;
  }
  return (
    <div ref={wrapRef} className={`relative bg-white rounded-lg overflow-hidden border border-gray-200 ${fs ? "fixed inset-0 z-50 rounded-none" : ""}`}>
      <div className="absolute top-2 right-2 z-20 flex items-center gap-1 relative">
        <button
          type="button"
          onClick={() => setPanelOpen(o => !o)}
          className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] uppercase tracking-wider ${panelOpen ? "bg-brand-600 border-brand-500 text-white" : "bg-white/90 border-gray-300 text-gray-600 hover:text-gray-900"}`}
          title="Indicators"
        >
          <LineChart size={12} /> Indicators{enabled.size > 0 ? ` (${enabled.size})` : ""}
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="p-1.5 rounded bg-white/90 border border-gray-300 text-gray-600 hover:text-gray-900 shadow-sm"
          title={fs ? "Exit full view" : "Full view"}
        >
          {fs ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        {panelOpen && (
          <IndicatorsPanel enabled={enabled} onToggle={toggleIndicator} onSetMany={setMany} onClose={() => setPanelOpen(false)} />
        )}
      </div>
      <div ref={ref} className="w-full" style={{ height: fs ? "100vh" : height }} />
    </div>
  );
}
