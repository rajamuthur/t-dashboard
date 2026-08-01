"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart, ColorType, CandlestickSeries, LineSeries, HistogramSeries,
  IChartApi, ISeriesApi, IPriceLine, UTCTimestamp, LineStyle,
} from "lightweight-charts";
import { Minus, TrendingUp, MoveRight, Trash2, Maximize2, Minimize2, MousePointer } from "lucide-react";
import { LiveCandle } from "@/lib/liveSources";

type Tool = null | "trend" | "hline" | "hray";
interface Drawing { id: string; kind: "trend" | "hline" | "hray"; color: string; width: number; timeframe: string; price?: number; t1?: number; p1?: number; t2?: number; p2?: number; }
interface Props { candles: LiveCandle[]; symbol: string; timeframe: string; livePrice?: number | null; height?: number; }

const COLORS = ["#111827", "#2563eb", "#dc2626", "#16a34a", "#d97706", "#0891b2"];   // black default
const NO_AUTOSCALE = () => null;   // overlays must NOT drive the price scale (else it explodes to 1e37)
const lsKey = (sym: string) => `charts:draw:${sym}`;
function loadDrawings(sym: string): Drawing[] {
  if (typeof window === "undefined" || !sym) return [];
  try { const r = JSON.parse(window.localStorage.getItem(lsKey(sym)) || "[]"); return Array.isArray(r) ? r : []; } catch { return []; }
}

const TF_STEP: Record<string, number> = { "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "1d": 86400, "1wk": 604800, "1mo": 2629800 };
function futureTimes(last: number, tf: string, n: number): number[] {
  const step = TF_STEP[tf] || 86400;
  const out: number[] = []; let t = last, guard = 0;
  while (out.length < n && guard < n * 3) { guard++; t += step; if (tf === "1d") { const d = new Date(t * 1000).getUTCDay(); if (d === 0 || d === 6) continue; } out.push(t); }
  return out;
}

export default function ChartsChart({ candles, symbol, timeframe, livePrice, height = 520 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlayRef = useRef<{ series: ISeriesApi<any>[]; lines: IPriceLine[] }>({ series: [], lines: [] });
  const previewRef = useRef<ISeriesApi<any> | null>(null);
  const lastBarRef = useRef<LiveCandle | null>(null);
  const toolRef = useRef<Tool>(null);
  const anchorRef = useRef<{ t: number; p: number } | null>(null);
  const styleRef = useRef({ color: COLORS[0], width: 2 });
  const drawingsRef = useRef<Drawing[]>([]);
  const dragRef = useRef<{ id: string; idx: number } | null>(null);

  const [tool, setTool] = useState<Tool>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(2);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [handles, setHandles] = useState<{ x: number; y: number; idx: number }[]>([]);
  const [fs, setFs] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => { styleRef.current = { color, width }; }, [color, width]);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
  useEffect(() => { setDrawings(loadDrawings(symbol)); cancelDraw(); setSelectedId(null); }, [symbol]);
  useEffect(() => {
    toolRef.current = tool;
    if (tool) setSelectedId(null);
    if (!tool) { cancelDraw(); setHint(""); }
    else setHint(tool === "trend" ? "click point A" : tool === "hray" ? "click to place a ray" : "click to place a line");
  }, [tool]);

  function persist(next: Drawing[]) { setDrawings(next); try { window.localStorage.setItem(lsKey(symbol), JSON.stringify(next)); } catch {} }
  function add(d: Omit<Drawing, "id" | "color" | "width" | "timeframe">) {
    persist([...loadDrawings(symbol), { ...d, id: `${Date.now()}_${Math.floor(performance.now())}`, color: styleRef.current.color, width: styleRef.current.width, timeframe }]);
  }
  function updateDrawing(id: string, patch: Partial<Drawing>) { persist(drawings.map(d => d.id === id ? { ...d, ...patch } : d)); }
  function removePreview() { const c = chartRef.current, s = previewRef.current; if (c && s) { try { c.removeSeries(s); } catch {} } previewRef.current = null; }
  function cancelDraw() { anchorRef.current = null; removePreview(); }

  function clearOverlays() {
    const chart = chartRef.current, s = candleRef.current;
    overlayRef.current.series.forEach(ser => { try { chart?.removeSeries(ser); } catch {} });
    overlayRef.current.lines.forEach(l => { try { s?.removePriceLine(l); } catch {} });
    overlayRef.current = { series: [], lines: [] };
  }
  const drawOverlays = useCallback(() => {
    const chart = chartRef.current, s = candleRef.current;
    if (!chart || !s || candles.length === 0) return;
    clearOverlays();
    for (const d of drawings) {
      if (d.kind === "hline" && d.price != null) {
        overlayRef.current.lines.push(s.createPriceLine({ price: d.price, color: d.color, lineWidth: d.width as any, axisLabelVisible: true, title: "" }));
      } else if (d.kind === "hray" && d.price != null && d.t1 != null) {
        const ls = chart.addSeries(LineSeries, { color: d.color, lineWidth: d.width as any, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: NO_AUTOSCALE });
        ls.setData([{ time: d.t1 as UTCTimestamp, value: d.price }, { time: (farRight() ?? d.t1) as UTCTimestamp, value: d.price }] as any);
        overlayRef.current.series.push(ls);
      } else if (d.kind === "trend" && d.t1 != null && d.p1 != null && d.t2 != null && d.p2 != null && d.t1 !== d.t2 && d.timeframe === timeframe) {
        const pts = [{ time: d.t1, value: d.p1 }, { time: d.t2, value: d.p2 }].sort((a, b) => a.time - b.time);   // clean A→B segment
        const ls = chart.addSeries(LineSeries, { color: d.color, lineWidth: d.width as any, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: NO_AUTOSCALE });
        ls.setData(pts as any);
        overlayRef.current.series.push(ls);
      }
    }
  }, [drawings, candles, timeframe]);

  const farRef = useRef<number>(0);
  const farRight = () => farRef.current;

  // Endpoint handles (pixel positions) for the selected drawing.
  const computeHandles = useCallback(() => {
    const chart = chartRef.current, s = candleRef.current;
    const d = drawings.find(x => x.id === selectedId);
    if (!chart || !s || !d) { setHandles([]); return; }
    const px = (t: number, p: number) => { const x = chart.timeScale().timeToCoordinate(t as UTCTimestamp); const y = s.priceToCoordinate(p); return x == null || y == null ? null : { x, y }; };
    const pts: { x: number; y: number; idx: number }[] = [];
    if (d.kind === "trend" && d.t1 != null && d.p1 != null && d.t2 != null && d.p2 != null) {
      const a = px(d.t1, d.p1), b = px(d.t2, d.p2);
      if (a) pts.push({ ...a, idx: 0 }); if (b) pts.push({ ...b, idx: 1 });
    } else if ((d.kind === "hline" || d.kind === "hray") && d.price != null) {
      const t = d.kind === "hray" && d.t1 != null ? d.t1 : candles[Math.floor(candles.length / 2)]?.time;
      const a = t != null ? px(t, d.price) : null; if (a) pts.push({ ...a, idx: 0 });
    }
    setHandles(pts);
  }, [drawings, selectedId, candles]);

  useEffect(() => { computeHandles(); }, [computeHandles]);

  // fullscreen
  useEffect(() => {
    function onFs() { setFs(!!document.fullscreenElement && document.fullscreenElement === wrapRef.current); setTimeout(() => { if (chartRef.current && containerRef.current) chartRef.current.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight }); }, 100); }
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  async function toggleFs() { const el = wrapRef.current; if (!el) return; try { if (document.fullscreenElement) await document.exitFullscreen(); else await el.requestFullscreen(); } catch {} }
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { setTool(null); cancelDraw(); setSelectedId(null); } }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // build chart
  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#334155" },
      grid: { vertLines: { color: "#eef2f7" }, horzLines: { color: "#eef2f7" } },
      width: containerRef.current.clientWidth, height: fs ? window.innerHeight : height,
      timeScale: { borderColor: "#cbd5e1", timeVisible: timeframe.endsWith("m") || timeframe === "1h", secondsVisible: false },
      rightPriceScale: { borderColor: "#cbd5e1" }, crosshair: { mode: 0 },   // free crosshair
    });
    const candle = chart.addSeries(CandlestickSeries, { upColor: "#16a34a", downColor: "#dc2626", borderUpColor: "#16a34a", borderDownColor: "#dc2626", wickUpColor: "#16a34a", wickDownColor: "#dc2626" });
    const nFut = timeframe === "1mo" ? 12 : timeframe === "1wk" ? 26 : 50;
    const lastReal = candles[candles.length - 1].time;
    const fut = futureTimes(lastReal, timeframe, nFut);
    farRef.current = fut[fut.length - 1] ?? lastReal;
    candle.setData(candles.map(c => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })) as any);
    const ws = chart.addSeries(LineSeries, { color: "rgba(0,0,0,0)", lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: NO_AUTOSCALE });
    const lastClose = candles[candles.length - 1].close;
    ws.setData(fut.map(t => ({ time: t as UTCTimestamp, value: lastClose })) as any);   // transparent line → reliably extends the time axis into the future
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "" }, 1);
    vol.setData(candles.map(c => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "#86efac" : "#fca5a5" })) as any);
    chart.panes()[1]?.setHeight(90);
    chartRef.current = chart; candleRef.current = candle;
    lastBarRef.current = candles[candles.length - 1];
    // Default view = recent bars + the future whitespace zone (thick candles, room to draw right).
    drawOverlays();
    computeHandles();

    const priceAt = (y: number) => { const p = candle.coordinateToPrice(y); return p == null ? null : Number(p); };
    const timeAt = (param: any): number | null => (typeof param.time === "number" ? param.time : (chart.timeScale().coordinateToTime(param.point?.x) as number | null));

    const onClick = (param: any) => {
      if (dragRef.current || !param.point) return;
      const t = toolRef.current;
      const price = priceAt(param.point.y);
      const time = timeAt(param);
      if (!t) {   // cursor → select a line under the click
        if (price == null) return;
        const y = param.point.y; let hit: string | null = null;
        for (const d of drawingsRef.current) {
          let v: number | null = null;
          if (d.kind === "hline") v = d.price ?? null;
          else if (d.kind === "hray") { if (time != null && d.t1 != null && time >= d.t1) v = d.price ?? null; }
          else if (d.kind === "trend" && d.t1 != null && d.p1 != null && d.t2 != null && d.p2 != null && d.timeframe === timeframe && time != null && d.t1 !== d.t2) v = d.p1 + (d.p2 - d.p1) / (d.t2 - d.t1) * (time - d.t1);
          if (v == null) continue;
          const ly = candle.priceToCoordinate(v);
          if (ly != null && Math.abs(ly - y) <= 6) { hit = d.id; break; }
        }
        setSelectedId(hit);
        return;
      }
      if (price == null) return;
      if (t === "hline") { add({ kind: "hline", price: Number(price.toFixed(2)) }); setTool(null); return; }
      if (time == null) return;
      if (t === "hray") { add({ kind: "hray", price: Number(price.toFixed(2)), t1: time }); setTool(null); return; }
      if (!anchorRef.current) { anchorRef.current = { t: time, p: price }; setHint("click point B"); }
      else if (time !== anchorRef.current.t) { const a = anchorRef.current; add({ kind: "trend", t1: a.t, p1: a.p, t2: time, p2: price }); cancelDraw(); setTool(null); }
    };
    const onMove = (param: any) => {
      const a = anchorRef.current; if (toolRef.current !== "trend" || !a || !param.point) return;
      const price = priceAt(param.point.y); const time = timeAt(param);
      if (price == null || time == null || time === a.t) return;
      if (!previewRef.current) previewRef.current = chart.addSeries(LineSeries, { color: styleRef.current.color, lineWidth: styleRef.current.width as any, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: NO_AUTOSCALE });
      previewRef.current.setData([{ time: a.t, value: a.p }, { time, value: price }].sort((x, y) => (x.time as number) - (y.time as number)) as any);
    };
    chart.subscribeClick(onClick);
    chart.subscribeCrosshairMove(onMove);
    const onRange = () => computeHandles();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const ro = new ResizeObserver(() => { if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth }); computeHandles(); });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.unsubscribeClick(onClick); chart.unsubscribeCrosshairMove(onMove); chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange); chart.remove(); chartRef.current = null; candleRef.current = null; previewRef.current = null; overlayRef.current = { series: [], lines: [] }; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, timeframe, height, fs]);

  useEffect(() => { drawOverlays(); computeHandles(); }, [drawOverlays, computeHandles]);

  useEffect(() => {
    const s = candleRef.current, bar = lastBarRef.current;
    if (!s || !bar || livePrice == null) return;
    const high = Math.max(bar.high, livePrice), low = Math.min(bar.low, livePrice);
    s.update({ time: bar.time as UTCTimestamp, open: bar.open, high, low, close: livePrice } as any);
    lastBarRef.current = { ...bar, high, low, close: livePrice };
  }, [livePrice]);

  // ---- endpoint dragging ----
  function onDragMove(e: MouseEvent) {
    const drag = dragRef.current, chart = chartRef.current, s = candleRef.current, cont = containerRef.current;
    if (!drag || !chart || !s || !cont) return;
    const rect = cont.getBoundingClientRect();
    const time = chart.timeScale().coordinateToTime(e.clientX - rect.left) as number | null;
    const price = s.coordinateToPrice(e.clientY - rect.top);
    if (price == null) return;
    setDrawings(prev => prev.map(d => {
      if (d.id !== drag.id) return d;
      if (d.kind === "trend") return drag.idx === 0 ? { ...d, ...(time != null ? { t1: time } : {}), p1: Number(price) } : { ...d, ...(time != null ? { t2: time } : {}), p2: Number(price) };
      if (d.kind === "hray") return { ...d, price: Number(price), ...(time != null ? { t1: time } : {}) };
      return { ...d, price: Number(price) };
    }));
  }
  function onDragUp() {
    dragRef.current = null;
    chartRef.current?.applyOptions({ handleScroll: true, handleScale: true });
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragUp);
    setDrawings(prev => { try { window.localStorage.setItem(lsKey(symbol), JSON.stringify(prev)); } catch {} return prev; });
  }
  function startDrag(id: string, idx: number, e: React.MouseEvent) {
    e.stopPropagation(); e.preventDefault();
    dragRef.current = { id, idx };
    chartRef.current?.applyOptions({ handleScroll: false, handleScale: false });
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragUp);
  }

  const ToolBtn = ({ t, icon: Icon, label }: { t: Tool; icon: any; label: string }) => (
    <button onClick={() => setTool(tool === t ? null : t)} title={label}
      className={`flex items-center gap-1 px-2 py-1 rounded border ${tool === t ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-100"}`}>
      <Icon size={12} /> <span className="hidden sm:inline">{label}</span>
    </button>
  );
  const selected = drawings.find(d => d.id === selectedId);

  return (
    <div ref={wrapRef} className={`relative bg-white rounded-lg border border-gray-200 ${fs ? "fixed inset-0 z-50 rounded-none" : ""}`}>
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-gray-200 text-xs flex-wrap relative">
        <button onClick={() => setTool(null)} title="Cursor" className={`flex items-center px-2 py-1 rounded border ${!tool ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-100"}`}><MousePointer size={12} /></button>
        <ToolBtn t="trend" icon={TrendingUp} label="Trend Line" />
        <ToolBtn t="hline" icon={Minus} label="Horizontal" />
        <ToolBtn t="hray" icon={MoveRight} label="H-Ray" />
        <div className="flex items-center gap-1 ml-1">{COLORS.map(c => <button key={c} onClick={() => setColor(c)} className={`w-4 h-4 rounded-full border-2 ${color === c ? "border-gray-800" : "border-gray-200"}`} style={{ background: c }} />)}</div>
        <select value={width} onChange={e => setWidth(Number(e.target.value))} className="border border-gray-300 rounded px-1 py-0.5 text-gray-700" title="Line width">{[1, 2, 3, 4].map(w => <option key={w} value={w}>{w}px</option>)}</select>
        {tool && <span className="text-blue-600">{hint}</span>}
        {!tool && drawings.length > 0 && !selectedId && <span className="text-gray-400">click a line to edit / drag its ends</span>}
        <button onClick={toggleFs} className="ml-auto flex items-center px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100" title={fs ? "Exit fullscreen" : "Fullscreen"}>{fs ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
      </div>

      {selected && (
        <div className="absolute top-11 left-2 z-30 bg-white border border-gray-300 rounded-lg shadow-lg p-2 text-xs text-gray-700 space-y-1.5">
          <div className="flex items-center justify-between gap-6"><span className="font-medium">{selected.kind === "hline" ? "Horizontal" : selected.kind === "hray" ? "H-Ray" : "Trend"} line {selected.kind === "trend" ? "· drag the circles to move" : ""}</span><button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-700">✕</button></div>
          <div className="flex items-center gap-1">{COLORS.map(c => <button key={c} onClick={() => updateDrawing(selected.id, { color: c })} className={`w-4 h-4 rounded-full border-2 ${selected.color === c ? "border-gray-800" : "border-gray-200"}`} style={{ background: c }} />)}</div>
          <div className="flex items-center gap-2">
            <select value={selected.width} onChange={e => updateDrawing(selected.id, { width: Number(e.target.value) })} className="border border-gray-300 rounded px-1 py-0.5">{[1, 2, 3, 4].map(w => <option key={w} value={w}>{w}px</option>)}</select>
            {(selected.kind === "hline" || selected.kind === "hray") && <input type="number" step="any" value={selected.price ?? 0} onChange={e => updateDrawing(selected.id, { price: parseFloat(e.target.value) || 0 })} className="w-24 border border-gray-300 rounded px-1 py-0.5" title="Price level" />}
            <button onClick={() => { persist(drawings.filter(x => x.id !== selected.id)); setSelectedId(null); }} className="ml-auto flex items-center gap-1 text-red-500 hover:text-red-700"><Trash2 size={13} /> delete</button>
          </div>
        </div>
      )}

      {candles.length === 0
        ? <div className="flex items-center justify-center text-gray-400 text-sm" style={{ height }}>No chart data.</div>
        : <div className="relative">
            <div ref={containerRef} className={`w-full ${tool ? "cursor-crosshair" : ""}`} style={{ height: fs ? "calc(100vh - 40px)" : height }} />
            {selected && handles.map(h => (
              <div key={h.idx} onMouseDown={e => startDrag(selected.id, h.idx, e)}
                className="absolute w-3.5 h-3.5 rounded-full bg-white border-2 border-blue-600 cursor-move z-40 shadow"
                style={{ left: h.x, top: h.y, transform: "translate(-50%,-50%)" }} />
            ))}
          </div>}
    </div>
  );
}
