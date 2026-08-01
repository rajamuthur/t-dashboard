"use client";
import { useEffect, useRef, useState } from "react";
import {
  createChart, ColorType, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers,
  IChartApi, ISeriesApi, IPriceLine, UTCTimestamp, LineStyle,
} from "lightweight-charts";
import { Minus, TrendingUp, Trash2, Maximize2, Minimize2, MousePointer } from "lucide-react";
import { LiveCandle } from "@/lib/liveSources";

interface Drawing { id: string; kind: "horizontal" | "trend"; color: string; width: number; timeframe: string; price?: number; t1?: number; p1?: number; t2?: number; p2?: number; }
interface Props { candles: LiveCandle[]; symbol: string; timeframe: string; livePrice?: number | null; height?: number; }

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];
const lsKey = (sym: string) => `charts:draw:${sym}`;

function loadDrawings(sym: string): Drawing[] {
  if (typeof window === "undefined" || !sym) return [];
  try { const r = JSON.parse(window.localStorage.getItem(lsKey(sym)) || "[]"); return Array.isArray(r) ? r : []; } catch { return []; }
}

export default function ChartsChart({ candles, symbol, timeframe, livePrice, height = 520 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlayRef = useRef<{ series: ISeriesApi<any>[]; lines: IPriceLine[] }>({ series: [], lines: [] });
  const lastBarRef = useRef<LiveCandle | null>(null);
  const drawRef = useRef<null | "horizontal" | "trend">(null);
  const pendingRef = useRef<{ t: number; p: number } | null>(null);
  const styleRef = useRef({ color: COLORS[0], width: 2 });

  const [drawMode, setDrawMode] = useState<null | "horizontal" | "trend">(null);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(2);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [fs, setFs] = useState(false);

  useEffect(() => { drawRef.current = drawMode; if (!drawMode) { pendingRef.current = null; marker(); } }, [drawMode]);
  useEffect(() => { styleRef.current = { color, width }; }, [color, width]);
  useEffect(() => { setDrawings(loadDrawings(symbol)); setDrawMode(null); }, [symbol]);

  function persist(next: Drawing[]) {
    setDrawings(next);
    try { window.localStorage.setItem(lsKey(symbol), JSON.stringify(next)); } catch {}
  }
  function addDrawing(d: Omit<Drawing, "id" | "color" | "width" | "timeframe">) {
    persist([...drawings, { ...d, id: `${Date.now()}_${drawings.length}`, color: styleRef.current.color, width: styleRef.current.width, timeframe }]);
  }
  function removeDrawing(id: string) { persist(drawings.filter(d => d.id !== id)); }

  function marker() {
    const s = candleRef.current; if (!s) return;
    const p = pendingRef.current;
    createSeriesMarkers(s, p ? [{ time: p.t as UTCTimestamp, position: "inBar", color: "#3b82f6", shape: "circle", text: "A" }] : []);
  }
  function clearOverlays() {
    const chart = chartRef.current, s = candleRef.current;
    overlayRef.current.series.forEach(ser => { try { chart?.removeSeries(ser); } catch {} });
    overlayRef.current.lines.forEach(l => { try { s?.removePriceLine(l); } catch {} });
    overlayRef.current = { series: [], lines: [] };
  }
  function drawOverlays() {
    const chart = chartRef.current, s = candleRef.current;
    if (!chart || !s || candles.length === 0) return;
    clearOverlays();
    const lastT = candles[candles.length - 1].time;
    for (const d of drawings) {
      if (d.kind === "horizontal" && d.price != null) {
        overlayRef.current.lines.push(s.createPriceLine({ price: d.price, color: d.color, lineWidth: d.width as any, axisLabelVisible: true, title: "" }));
      } else if (d.kind === "trend" && d.t1 != null && d.p1 != null && d.t2 != null && d.p2 != null && d.timeframe === timeframe) {
        const pts = [{ time: d.t1 as UTCTimestamp, value: d.p1 }, { time: d.t2 as UTCTimestamp, value: d.p2 }].sort((a, b) => (a.time as number) - (b.time as number));
        if (d.t2 !== d.t1 && lastT > (pts[1].time as number)) {
          const slope = (d.p2 - d.p1) / (d.t2 - d.t1);
          pts.push({ time: lastT as UTCTimestamp, value: d.p1 + slope * (lastT - d.t1) });
        }
        const ls = chart.addSeries(LineSeries, { color: d.color, lineWidth: d.width as any, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
        ls.setData(pts as any);
        overlayRef.current.series.push(ls);
      }
    }
  }

  // fullscreen tracking
  useEffect(() => {
    function onFs() { setFs(!!document.fullscreenElement && document.fullscreenElement === wrapRef.current); setTimeout(() => { if (chartRef.current && containerRef.current) chartRef.current.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight }); }, 100); }
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  async function toggleFs() {
    const el = wrapRef.current; if (!el) return;
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await el.requestFullscreen(); } catch {}
  }

  // build chart on candle set change
  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#334155" },
      grid: { vertLines: { color: "#eef2f7" }, horzLines: { color: "#eef2f7" } },
      width: containerRef.current.clientWidth, height: fs ? window.innerHeight : height,
      timeScale: { borderColor: "#cbd5e1", timeVisible: timeframe.endsWith("m") || timeframe === "1h", secondsVisible: false },
      rightPriceScale: { borderColor: "#cbd5e1" },
      crosshair: { mode: 1 },   // magnet; shows X (time) + Y (price) axis labels on hover
    });
    const candle = chart.addSeries(CandlestickSeries, { upColor: "#16a34a", downColor: "#dc2626", borderUpColor: "#16a34a", borderDownColor: "#dc2626", wickUpColor: "#16a34a", wickDownColor: "#dc2626" });
    candle.setData(candles.map(c => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })) as any);
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "" }, 1);
    vol.setData(candles.map(c => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "#86efac" : "#fca5a5" })) as any);
    chart.panes()[1]?.setHeight(90);

    chartRef.current = chart; candleRef.current = candle;
    lastBarRef.current = candles[candles.length - 1];
    chart.timeScale().fitContent();
    drawOverlays();

    const onClick = (param: any) => {
      const mode = drawRef.current;
      if (!mode || !param.point) return;
      const price = candle.coordinateToPrice(param.point.y);
      if (price == null) return;
      const t = (typeof param.time === "number" ? param.time : chart.timeScale().coordinateToTime(param.point.x)) as number | null;
      if (mode === "horizontal") { addDrawing({ kind: "horizontal", price: Number(Number(price).toFixed(2)) }); setDrawMode(null); return; }
      if (t == null) return;
      if (!pendingRef.current) { pendingRef.current = { t, p: Number(price) }; marker(); }
      else { const a = pendingRef.current; addDrawing({ kind: "trend", t1: a.t, p1: a.p, t2: t, p2: Number(price) }); pendingRef.current = null; marker(); setDrawMode(null); }
    };
    chart.subscribeClick(onClick);
    const ro = new ResizeObserver(() => { if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth }); });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.unsubscribeClick(onClick); chart.remove(); chartRef.current = null; candleRef.current = null; overlayRef.current = { series: [], lines: [] }; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, timeframe, height, fs]);

  useEffect(() => { drawOverlays(); /* eslint-disable-next-line */ }, [drawings]);

  // live last price
  useEffect(() => {
    const s = candleRef.current, bar = lastBarRef.current;
    if (!s || !bar || livePrice == null) return;
    const high = Math.max(bar.high, livePrice), low = Math.min(bar.low, livePrice);
    const upd = { ...bar, high, low, close: livePrice };
    s.update({ time: bar.time as UTCTimestamp, open: bar.open, high, low, close: livePrice } as any);
    lastBarRef.current = upd;
  }, [livePrice]);

  return (
    <div ref={wrapRef} className={`bg-white rounded-lg border border-gray-200 ${fs ? "fixed inset-0 z-50 rounded-none" : ""}`}>
      {/* draw toolbar */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-200 text-xs flex-wrap">
        <button onClick={() => setDrawMode(null)} className={`flex items-center gap-1 px-2 py-1 rounded border ${!drawMode ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-100"}`} title="Cursor"><MousePointer size={12} /></button>
        <button onClick={() => setDrawMode(drawMode === "horizontal" ? null : "horizontal")} className={`flex items-center gap-1 px-2 py-1 rounded border ${drawMode === "horizontal" ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-100"}`}><Minus size={12} /> H-line</button>
        <button onClick={() => setDrawMode(drawMode === "trend" ? null : "trend")} className={`flex items-center gap-1 px-2 py-1 rounded border ${drawMode === "trend" ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-100"}`}><TrendingUp size={12} /> Trend</button>
        <div className="flex items-center gap-1 ml-1">
          {COLORS.map(c => <button key={c} onClick={() => setColor(c)} className={`w-4 h-4 rounded-full border-2 ${color === c ? "border-gray-800" : "border-white"}`} style={{ background: c }} />)}
        </div>
        <select value={width} onChange={e => setWidth(Number(e.target.value))} className="border border-gray-300 rounded px-1 py-0.5 text-gray-700" title="Line width">
          {[1, 2, 3, 4].map(w => <option key={w} value={w}>{w}px</option>)}
        </select>
        {drawings.length > 0 && <button onClick={() => persist([])} className="flex items-center gap-1 px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100" title="Clear all drawings"><Trash2 size={12} /> {drawings.length}</button>}
        {drawMode && <span className="text-blue-600">{drawMode === "horizontal" ? "click to place a line" : pendingRef.current ? "click point B" : "click A then B"}</span>}
        <button onClick={toggleFs} className="ml-auto flex items-center px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100" title={fs ? "Exit fullscreen" : "Fullscreen"}>{fs ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
      </div>
      {candles.length === 0
        ? <div className="flex items-center justify-center text-gray-400 text-sm" style={{ height }}>No chart data.</div>
        : <div ref={containerRef} className={`w-full ${drawMode ? "cursor-crosshair" : ""}`} style={{ height: fs ? "calc(100vh - 40px)" : height }} />}
    </div>
  );
}
