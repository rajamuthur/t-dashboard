"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, ColorType, CandlestickSeries, LineSeries, HistogramSeries,
  IChartApi, ISeriesApi, IPriceLine, UTCTimestamp, LineStyle,
} from "lightweight-charts";
import { LineChart, Maximize2, Minimize2, EyeOff } from "lucide-react";
import {
  LiveCandle, LiveSource, SymbolMatch,
  getLiveCandles, getLiveQuote, getHyperliquidWS, searchSymbols,
} from "@/lib/liveSources";
import {
  calcSMA, calcEMA, calcBollinger, calcSupertrend, calcIchimoku, calcPivotPoints,
  calcFairValueGaps, calcVolumeProfile, calcVolume,
  calcRSI, calcMACD, calcStochastic, calcATR, calcADX, calcCCI, calcOBV, calcMFI, calcWilliamsR,
} from "@/lib/indicators";
import { INDICATORS, INDICATOR_COLOR, DEFAULT_INDICATORS } from "@/lib/indicatorCatalog";
import IndicatorsPanel from "./IndicatorsPanel";

export interface PaneConfig {
  source: string;
  symbol: string;
  timeframe: string;
  indicators?: string[];   // persisted indicator IDs
}

interface Props {
  config: PaneConfig;
  sources: LiveSource[];
  onChange: (next: PaneConfig) => void;
}

// One indicator can own multiple series (e.g. Bollinger = upper+middle+lower)
// and/or price lines on the candlestick series (e.g. Pivot Points).
interface IndicatorHandles {
  series: ISeriesApi<any>[];
  priceLines: IPriceLine[];
}

export default function LiveChartPane({ config, sources, onChange }: Props) {
  const { source, symbol, timeframe } = config;
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const candlesRef = useRef<LiveCandle[]>([]);
  const lastBarRef = useRef<LiveCandle | null>(null);
  const indicatorHandlesRef = useRef<Map<string, IndicatorHandles>>(new Map());
  const nextPaneIndexRef = useRef<number>(1);   // 0 = price pane; sub-panes count up
  const refreshTimerRef = useRef<number | null>(null);
  const lastRefreshAtRef = useRef<number>(0);

  const [price, setPrice] = useState<number | null>(null);
  const [refPrice, setRefPrice] = useState<number | null>(null);  // prior-bar close — baseline for change %
  const [lastBar, setLastBar] = useState<LiveCandle | null>(null);  // mirrors lastBarRef for OHLCV display
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<SymbolMatch[]>([]);
  const [symbolDraft, setSymbolDraft] = useState<string>(symbol);
  const [panelOpen, setPanelOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const enabledIds = useMemo(
    () => new Set<string>(config.indicators ?? Array.from(DEFAULT_INDICATORS)),
    [config.indicators],
  );
  // Mirror enabledIds in a ref so the throttled tick refresh always reads
  // the *current* set — not the one captured by the load effect's closure.
  const enabledIdsRef = useRef<Set<string>>(enabledIds);
  useEffect(() => { enabledIdsRef.current = enabledIds; }, [enabledIds]);

  const activeSource = useMemo(
    () => sources.find(s => s.name === source) ?? sources[0],
    [sources, source],
  );

  useEffect(() => { setSymbolDraft(symbol); }, [symbol]);

  // Track browser fullscreen state so the icon flips and Esc updates state.
  useEffect(() => {
    function onFs() {
      const el = document.fullscreenElement;
      setFullscreen(!!el && el === rootRef.current);
    }
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  async function toggleFullscreen() {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch { /* permission denied / unsupported — silently ignore */ }
  }

  // Debounced search → drives the datalist
  useEffect(() => {
    let cancelled = false;
    const q = symbolDraft.trim();
    const handle = window.setTimeout(async () => {
      try {
        const rows = await searchSymbols(source, q, 50);
        if (!cancelled) setSuggestions(rows);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 200);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [symbolDraft, source]);

  // --- create chart once ---
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#334155" },
      grid: { vertLines: { color: "#e2e8f0" }, horzLines: { color: "#e2e8f0" } },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      timeScale: { borderColor: "#cbd5e1", timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: "#cbd5e1" },
      crosshair: { mode: 1 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a", downColor: "#dc2626",
      borderUpColor: "#16a34a", borderDownColor: "#dc2626",
      wickUpColor: "#16a34a", wickDownColor: "#dc2626",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    });
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      indicatorHandlesRef.current.clear();
    };
  }, []);

  // ---------- indicator helpers ----------
  function removeIndicator(id: string) {
    const h = indicatorHandlesRef.current.get(id);
    if (!h) return;
    const chart = chartRef.current;
    for (const s of h.series) {
      try { chart?.removeSeries(s); } catch {}
    }
    for (const pl of h.priceLines) {
      try { seriesRef.current?.removePriceLine(pl); } catch {}
    }
    indicatorHandlesRef.current.delete(id);
  }

  function renderIndicator(id: string) {
    const chart = chartRef.current;
    const ps = seriesRef.current;
    if (!chart || !ps) return;
    const candles = candlesRef.current;
    if (candles.length === 0) return;

    // Tear down existing render for this id so a re-render is clean
    removeIndicator(id);
    const handles: IndicatorHandles = { series: [], priceLines: [] };

    const subPaneIndex = () => nextPaneIndexRef.current++;
    const addLine = (data: { time: number; value: number }[], color: string, paneIdx = 0, opts: any = {}) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, ...opts }, paneIdx);
      s.setData(data.map(d => ({ time: d.time as UTCTimestamp, value: d.value })));
      handles.series.push(s);
      return s;
    };
    const addHist = (data: { time: number; value: number; color?: string }[], color: string, paneIdx: number, opts: any = {}) => {
      const s = chart.addSeries(HistogramSeries, { color, priceLineVisible: false, lastValueVisible: false, ...opts }, paneIdx);
      s.setData(data.map(d => ({ time: d.time as UTCTimestamp, value: d.value, color: d.color })));
      handles.series.push(s);
      return s;
    };

    switch (id) {
      case "sma20": addLine(calcSMA(candles, 20), INDICATOR_COLOR.sma20); break;
      case "ema50": addLine(calcEMA(candles, 50), INDICATOR_COLOR.ema50); break;
      case "bb": {
        const bb = calcBollinger(candles, 20, 2);
        addLine(bb.upper, INDICATOR_COLOR.bb_upper);
        addLine(bb.middle, INDICATOR_COLOR.bb_mid, 0, { lineStyle: LineStyle.Dashed });
        addLine(bb.lower, INDICATOR_COLOR.bb_lower);
        break;
      }
      case "supertrend": addLine(calcSupertrend(candles, 10, 3), INDICATOR_COLOR.supertrend, 0, { lineWidth: 2 }); break;
      case "ichimoku": {
        const ich = calcIchimoku(candles);
        addLine(ich.tenkan,  INDICATOR_COLOR.ichi_tenkan);
        addLine(ich.kijun,   INDICATOR_COLOR.ichi_kijun);
        addLine(ich.senkouA, INDICATOR_COLOR.ichi_senkouA, 0, { lineStyle: LineStyle.Dotted });
        addLine(ich.senkouB, INDICATOR_COLOR.ichi_senkouB, 0, { lineStyle: LineStyle.Dotted });
        addLine(ich.chikou,  INDICATOR_COLOR.ichi_chikou,   0, { lineStyle: LineStyle.Dashed });
        break;
      }
      case "pivots": {
        const pp = calcPivotPoints(candles);
        if (!pp) break;
        const lines = [
          { v: pp.r3, c: INDICATOR_COLOR.pivot_r, t: "R3" },
          { v: pp.r2, c: INDICATOR_COLOR.pivot_r, t: "R2" },
          { v: pp.r1, c: INDICATOR_COLOR.pivot_r, t: "R1" },
          { v: pp.pp, c: INDICATOR_COLOR.pivot_pp, t: "P"  },
          { v: pp.s1, c: INDICATOR_COLOR.pivot_s, t: "S1" },
          { v: pp.s2, c: INDICATOR_COLOR.pivot_s, t: "S2" },
          { v: pp.s3, c: INDICATOR_COLOR.pivot_s, t: "S3" },
        ];
        for (const { v, c, t } of lines) {
          const pl = ps.createPriceLine({
            price: v, color: c, lineWidth: 1, lineStyle: LineStyle.Dotted,
            axisLabelVisible: true, title: t,
          });
          handles.priceLines.push(pl);
        }
        break;
      }
      case "fvg": {
        const gaps = calcFairValueGaps(candles);
        for (const g of gaps) {
          const color = g.kind === "bull" ? INDICATOR_COLOR.fvg_bull : INDICATOR_COLOR.fvg_bear;
          handles.priceLines.push(ps.createPriceLine({
            price: g.top, color, lineWidth: 1, lineStyle: LineStyle.Dashed,
            axisLabelVisible: false, title: g.kind === "bull" ? "FVG↑" : "FVG↓",
          }));
          handles.priceLines.push(ps.createPriceLine({
            price: g.bottom, color, lineWidth: 1, lineStyle: LineStyle.Dashed,
            axisLabelVisible: false, title: "",
          }));
        }
        break;
      }
      case "vp": {
        const vp = calcVolumeProfile(candles, 24);
        if (!vp) break;
        handles.priceLines.push(ps.createPriceLine({
          price: vp.poc, color: INDICATOR_COLOR.vp_poc, lineWidth: 2, lineStyle: LineStyle.Solid,
          axisLabelVisible: true, title: "POC",
        }));
        handles.priceLines.push(ps.createPriceLine({
          price: vp.vah, color: INDICATOR_COLOR.vp_vah, lineWidth: 1, lineStyle: LineStyle.Dashed,
          axisLabelVisible: true, title: "VAH",
        }));
        handles.priceLines.push(ps.createPriceLine({
          price: vp.val, color: INDICATOR_COLOR.vp_val, lineWidth: 1, lineStyle: LineStyle.Dashed,
          axisLabelVisible: true, title: "VAL",
        }));
        break;
      }
      case "volume":   { addHist(calcVolume(candles), "#64748b", subPaneIndex(), { priceFormat: { type: "volume" } }); break; }
      case "rsi": {
        const idx = subPaneIndex();
        addLine(calcRSI(candles, 14), INDICATOR_COLOR.rsi, idx);
        const ref = handles.series[0];
        handles.priceLines.push(ref.createPriceLine({ price: 70, color: "#ef444480", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" }));
        handles.priceLines.push(ref.createPriceLine({ price: 30, color: "#22c55e80", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" }));
        break;
      }
      case "macd": {
        const idx = subPaneIndex();
        const m = calcMACD(candles, 12, 26, 9);
        addHist(m.hist, "#94a3b8", idx);
        addLine(m.macd, INDICATOR_COLOR.macd_line, idx);
        addLine(m.signal, INDICATOR_COLOR.macd_signal, idx);
        break;
      }
      case "stoch": {
        const idx = subPaneIndex();
        const s = calcStochastic(candles, 14, 3, 3);
        addLine(s.k, INDICATOR_COLOR.stoch_k, idx);
        addLine(s.d, INDICATOR_COLOR.stoch_d, idx);
        break;
      }
      case "atr":      addLine(calcATR(candles, 14), INDICATOR_COLOR.atr, subPaneIndex()); break;
      case "adx": {
        const idx = subPaneIndex();
        const a = calcADX(candles, 14);
        addLine(a.adx,     INDICATOR_COLOR.adx,       idx, { lineWidth: 2 });
        addLine(a.plusDI,  INDICATOR_COLOR.adx_plus,  idx);
        addLine(a.minusDI, INDICATOR_COLOR.adx_minus, idx);
        break;
      }
      case "cci":      addLine(calcCCI(candles, 20), INDICATOR_COLOR.cci, subPaneIndex()); break;
      case "obv":      addLine(calcOBV(candles),     INDICATOR_COLOR.obv, subPaneIndex()); break;
      case "mfi":      addLine(calcMFI(candles, 14), INDICATOR_COLOR.mfi, subPaneIndex()); break;
      case "williams": addLine(calcWilliamsR(candles, 14), INDICATOR_COLOR.williams, subPaneIndex()); break;
    }
    indicatorHandlesRef.current.set(id, handles);
  }

  function refreshAllIndicators() {
    // Wipe & redraw — safest when candle history changes (load) and when toggling.
    // Read from the ref so callers from stale closures still see the live set.
    nextPaneIndexRef.current = 1;
    for (const id of Array.from(indicatorHandlesRef.current.keys())) removeIndicator(id);
    for (const id of enabledIdsRef.current) renderIndicator(id);
  }

  // Coalesced indicator refresh — called on every live tick.
  // Throttles to ~1Hz to keep render cost bounded with many indicators / sub-panes.
  function scheduleIndicatorRefresh() {
    const now = performance.now();
    const since = now - lastRefreshAtRef.current;
    const fire = () => {
      refreshTimerRef.current = null;
      lastRefreshAtRef.current = performance.now();
      refreshAllIndicators();
    };
    if (since >= 1000) {
      fire();
    } else if (refreshTimerRef.current == null) {
      refreshTimerRef.current = window.setTimeout(fire, 1000 - since);
    }
  }

  // --- load historical candles + subscribe live ---
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    async function load() {
      setLoading(true);
      setErr(null);
      setPrice(null);
      setRefPrice(null);
      setLastBar(null);
      setFlash(null);
      lastBarRef.current = null;
      candlesRef.current = [];
      seriesRef.current?.setData([]);
      // Strip indicators from previous symbol/timeframe before re-render
      for (const id of Array.from(indicatorHandlesRef.current.keys())) removeIndicator(id);
      nextPaneIndexRef.current = 1;

      try {
        const candles = await getLiveCandles(source, symbol, timeframe, 300);
        if (cancelled) return;
        if (!seriesRef.current) return;
        if (candles.length === 0) {
          setErr(`No data for "${symbol}" on ${source} (${timeframe}).`);
          return;
        }
        const data = candles.map(c => ({
          time: c.time as UTCTimestamp,
          open: c.open, high: c.high, low: c.low, close: c.close,
        }));
        seriesRef.current.setData(data);
        candlesRef.current = candles.slice();
        lastBarRef.current = candles[candles.length - 1];
        setPrice(candles[candles.length - 1].close);
        setRefPrice(candles.length >= 2 ? candles[candles.length - 2].close : candles[0].open);
        setLastBar(candles[candles.length - 1]);
        chartRef.current?.timeScale().fitContent();
        refreshAllIndicators();
      } catch (e: any) {
        if (!cancelled) setErr(e.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }

      if (cancelled) return;

      if (source === "hyperliquid") {
        const ws = getHyperliquidWS();
        cleanup = ws.subscribe(symbol, timeframe, (c) => applyCandle(c));
      } else {
        const id = window.setInterval(async () => {
          try {
            const q = await getLiveQuote(source, symbol);
            applyQuote(q.price, q.time);
          } catch { /* ignore transient errors */ }
        }, 5000);
        cleanup = () => window.clearInterval(id);
      }
    }

    function applyCandle(c: LiveCandle) {
      if (!seriesRef.current) return;
      seriesRef.current.update({
        time: c.time as UTCTimestamp,
        open: c.open, high: c.high, low: c.low, close: c.close,
      });
      const cs = candlesRef.current;
      if (cs.length && cs[cs.length - 1].time === c.time) cs[cs.length - 1] = c;
      else cs.push(c);
      lastBarRef.current = c;
      setLastBar(c);
      flashOnChange(c.close);
      scheduleIndicatorRefresh();
    }

    function applyQuote(p: number, _ts: number) {
      const bar = lastBarRef.current;
      if (!bar || !seriesRef.current) { flashOnChange(p); return; }
      const high = Math.max(bar.high, p);
      const low = Math.min(bar.low, p);
      const updated: LiveCandle = { ...bar, high, low, close: p };
      seriesRef.current.update({
        time: bar.time as UTCTimestamp,
        open: bar.open, high, low, close: p,
      });
      const cs = candlesRef.current;
      if (cs.length) cs[cs.length - 1] = updated;
      lastBarRef.current = updated;
      setLastBar(updated);
      flashOnChange(p);
      scheduleIndicatorRefresh();
    }

    function flashOnChange(p: number) {
      setPrice(prev => {
        if (prev != null && p !== prev) {
          setFlash(p > prev ? "up" : "down");
          window.setTimeout(() => setFlash(null), 320);
        }
        return p;
      });
    }

    load();
    return () => {
      cancelled = true;
      if (cleanup) cleanup();
      if (refreshTimerRef.current != null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, symbol, timeframe]);

  // Re-render indicators when the enabled set changes (e.g. user toggles a checkbox)
  useEffect(() => {
    if (candlesRef.current.length === 0) return;
    refreshAllIndicators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.indicators]);

  function toggleIndicator(id: string) {
    const next = new Set(enabledIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...config, indicators: Array.from(next) });
  }

  function setManyIndicators(ids: string[], on: boolean) {
    const next = new Set(enabledIds);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange({ ...config, indicators: Array.from(next) });
  }

  // ---- derived ticker values ----
  const change = price != null && refPrice != null ? price - refPrice : null;
  const changePct = change != null && refPrice ? (change / refPrice) * 100 : null;
  const up = change != null && change >= 0;

  function compact(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
    return n.toFixed(0);
  }
  function fmtPx(n: number) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  const tickerColor = flash === "up"
    ? "text-green-400"
    : flash === "down" ? "text-red-400"
    : up ? "text-green-400" : "text-red-400";

  return (
    <div
      ref={rootRef}
      className="flex flex-col h-full min-h-0 rounded-lg overflow-hidden border border-gray-800 bg-gray-950 relative"
    >
      {/* Top controls */}
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 bg-gray-900 border-b border-gray-800 text-xs relative">
        <select
          value={source}
          onChange={e => onChange({
            ...config,
            source: e.target.value,
            symbol: sources.find(s => s.name === e.target.value)?.default_symbols[0] ?? symbol,
          })}
          className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-100"
        >
          {sources.map(s => (<option key={s.name} value={s.name}>{s.label}</option>))}
        </select>

        <input
          list={`symbols-${source}`}
          value={symbolDraft}
          onChange={e => {
            const v = e.target.value;
            setSymbolDraft(v);
            const hit = suggestions.find(s => s.symbol === v.trim());
            if (hit) onChange({ ...config, symbol: hit.symbol });
          }}
          onBlur={() => {
            const v = symbolDraft.trim().toUpperCase();
            if (v && v !== symbol) onChange({ ...config, symbol: v });
            else if (!v) setSymbolDraft(symbol);
          }}
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="search symbol"
          spellCheck={false}
          autoComplete="off"
          className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 w-40 text-gray-100"
        />
        <datalist id={`symbols-${source}`}>
          {suggestions.map(s => (<option key={s.symbol} value={s.symbol}>{s.label}</option>))}
        </datalist>

        <select
          value={timeframe}
          onChange={e => onChange({ ...config, timeframe: e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-100"
        >
          {(activeSource?.timeframes ?? []).map(tf => (
            <option key={tf} value={tf}>{tf}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPanelOpen(o => !o)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] uppercase tracking-wider ${
              panelOpen
                ? "bg-brand-600 border-brand-500 text-white"
                : "bg-gray-800 border-gray-700 text-gray-300 hover:text-white"
            }`}
            title="Indicators"
          >
            <LineChart size={12} /> Indicators
            {enabledIds.size > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-gray-700 text-[10px] text-white">
                {enabledIds.size}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex items-center px-1.5 py-0.5 rounded border bg-gray-800 border-gray-700 text-gray-300 hover:text-white"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>

        {panelOpen && (
          <IndicatorsPanel
            enabled={enabledIds}
            onToggle={toggleIndicator}
            onSetMany={setManyIndicators}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </div>

      {/* Ticker bar — TradingView style: SYMBOL · O H L C · +Δ (+Δ%) · Vol */}
      <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1 px-3 py-1.5 border-b border-gray-800 bg-gray-950">
        <span className="text-sm font-semibold tracking-wide text-gray-100">{symbol}</span>
        <span className={`text-base font-mono font-semibold tabular-nums transition-colors duration-300 ${tickerColor}`}>
          {price != null ? fmtPx(price) : "—"}
        </span>
        {change != null && changePct != null && (
          <span className={`text-xs font-mono tabular-nums ${up ? "text-green-400" : "text-red-400"}`}>
            {(up ? "+" : "") + change.toFixed(2)} ({(up ? "+" : "") + changePct.toFixed(2)}%)
          </span>
        )}
        {lastBar && (
          <span className="text-[11px] font-mono tabular-nums text-gray-400 flex items-baseline gap-2 ml-auto">
            <span><span className="text-gray-500">O</span> {fmtPx(lastBar.open)}</span>
            <span><span className="text-gray-500">H</span> {fmtPx(lastBar.high)}</span>
            <span><span className="text-gray-500">L</span> {fmtPx(lastBar.low)}</span>
            <span><span className="text-gray-500">C</span> {fmtPx(lastBar.close)}</span>
            {lastBar.volume > 0 && (
              <span><span className="text-gray-500">Vol</span> {compact(lastBar.volume)}</span>
            )}
          </span>
        )}
      </div>

      {/* Chart */}
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" />

        {/* Legend overlay — TradingView-style indicator list with hide button */}
        {enabledIds.size > 0 && (
          <div className="absolute top-2 left-2 z-10 space-y-0.5 max-w-[60%]">
            {Array.from(enabledIds).map(id => {
              const meta = INDICATORS.find(m => m.id === id);
              if (!meta) return null;
              const swatch =
                INDICATOR_COLOR[id] ?? INDICATOR_COLOR[`${id}_line`] ?? "#94a3b8";
              return (
                <div
                  key={id}
                  className="group inline-flex items-center gap-1.5 text-[11px] text-gray-700 bg-white/80 border border-gray-200 backdrop-blur-sm rounded px-1.5 py-0.5 mr-1"
                >
                  <span
                    className="inline-block w-2 h-2 rounded-sm shrink-0"
                    style={{ background: swatch }}
                  />
                  <span className="whitespace-nowrap">{meta.label}</span>
                  <button
                    type="button"
                    onClick={() => toggleIndicator(id)}
                    className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    title={`Hide ${meta.label}`}
                  >
                    <EyeOff size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500 pointer-events-none">
            Loading…
          </div>
        )}
        {err && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-red-400 px-4 text-center">
            {err}
          </div>
        )}
      </div>
    </div>
  );
}
