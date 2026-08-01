"use client";
import { useEffect, useRef, useState } from "react";
import {
  createChart, ColorType, CandlestickSeries, LineSeries, HistogramSeries,
  IChartApi, ISeriesApi, IPriceLine, UTCTimestamp, LineStyle,
} from "lightweight-charts";
import { Minus, TrendingUp, MoveRight, Trash2, Maximize2, Minimize2, MousePointer } from "lucide-react";
import { LiveCandle } from "@/lib/liveSources";

type Tool = null | "trend" | "hline" | "hray";
interface Drawing { id: string; kind: "trend" | "hline" | "hray"; color: string; width: number; timeframe: string; price?: number; t1?: number; p1?: number; t2?: number; p2?: number; }
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
  const previewRef = useRef<ISeriesApi<any> | null>(null);
  const lastBarRef = useRef<LiveCandle | null>(null);
  const toolRef = useRef<Tool>(null);
  const anchorRef = useRef<{ t: number; p: number } | null>(null);
  const styleRef = useRef({ color: COLORS[0], width: 2 });

  const [tool, setTool] = useState<Tool>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(2);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [fs, setFs] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => { styleRef.current = { color, width }; }, [color, width]);
  useEffect(() => { setDrawings(loadDrawings(symbol)); cancelDraw(); }, [symbol]);
  useEffect(() => {
    toolRef.current = tool;
    if (!tool) { cancelDraw(); setHint(""); }
    else setHint(tool === "trend" ? "click point A" : tool === "hray" ? "click to place a ray" : "click to place a line");
  }, [tool]);

  function persist(next: Drawing[]) { setDrawings(next); try { window.localStorage.setItem(lsKey(symbol), JSON.stringify(next)); } catch {} }
  function add(d: Omit<Drawing, "id" | "color" | "width" | "timeframe">) {
    persist([...loadDrawings(symbol), { ...d, id: `${Date.now()}_${Math.floor(performance.now())}`, color: styleRef.current.color, width: styleRef.current.width, timeframe }]);
  }

  function removePreview() { const c = chartRef.current, s = previewRef.current; if (c && s) { try { c.removeSeries(s); } catch {} } previewRef.current = null; }
  function cancelDraw() { anchorRef.current = null; removePreview(); }

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
      if (d.kind === "hline" && d.price != null) {
        overlayRef.current.lines.push(s.createPriceLine({ price: d.price, color: d.color, lineWidth: d.width as any, axisLabelVisible: true, title: "" }));
      } else if (d.kind === "hray" && d.price != null && d.t1 != null) {
        const ls = chart.addSeries(LineSeries, { color: d.color, lineWidth: d.width as any, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
        ls.setData([{ time: Math.min(d.t1, lastT) as UTCTimestamp, value: d.price }, { time: lastT as UTCTimestamp, value: d.price }] as any);
        overlayRef.current.series.push(ls);
      } else if (d.kind === "trend" && d.t1 != null && d.p1 != null && d.t2 != null && d.p2 != null && d.timeframe === timeframe) {
        const pts = [{ time: d.t1 as UTCTimestamp, value: d.p1 }, { time: d.t2 as UTCTimestamp, value: d.p2 }].sort((a, b) => (a.time as number) - (b.time as number));
        const ls = chart.addSeries(LineSeries, { color: d.color, lineWidth: d.width as any, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
        ls.setData(pts as any);
        overlayRef.current.series.push(ls);
      }
    }
  }

  // fullscreen
  useEffect(() => {
    function onFs() { setFs(!!document.fullscreenElement && document.fullscreenElement === wrapRef.current); setTimeout(() => { if (chartRef.current && containerRef.current) chartRef.current.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight }); }, 100); }
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  async function toggleFs() { const el = wrapRef.current; if (!el) return; try { if (document.fullscreenElement) await document.exitFullscreen(); else await el.requestFullscreen(); } catch {} }

  // Esc cancels an in-progress draw
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { setTool(null); cancelDraw(); } }
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
      rightPriceScale: { borderColor: "#cbd5e1" }, crosshair: { mode: 1 },
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

    const priceAt = (y: number) => { const p = candle.coordinateToPrice(y); return p == null ? null : Number(p); };
    const timeAt = (param: any): number | null => (typeof param.time === "number" ? param.time : (chart.timeScale().coordinateToTime(param.point?.x) as number | null));

    const onClick = (param: any) => {
      const t = toolRef.current; if (!t || !param.point) return;
      const price = priceAt(param.point.y); if (price == null) return;
      if (t === "hline") { add({ kind: "hline", price: Number(price.toFixed(2)) }); setTool(null); return; }
      const time = timeAt(param); if (time == null) return;
      if (t === "hray") { add({ kind: "hray", price: Number(price.toFixed(2)), t1: time }); setTool(null); return; }
      // trend: two clicks with live preview
      if (!anchorRef.current) { anchorRef.current = { t: time, p: price }; setHint("click point B"); }
      else { const a = anchorRef.current; add({ kind: "trend", t1: a.t, p1: a.p, t2: time, p2: price }); cancelDraw(); setTool(null); }
    };
    const onMove = (param: any) => {
      const a = anchorRef.current; if (toolRef.current !== "trend" || !a || !param.point) return;
      const price = priceAt(param.point.y); const time = timeAt(param);
      if (price == null || time == null) return;
      if (!previewRef.current) previewRef.current = chart.addSeries(LineSeries, { color: styleRef.current.color, lineWidth: styleRef.current.width as any, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
      previewRef.current.setData([{ time: a.t, value: a.p }, { time, value: price }].sort((x, y) => (x.time as number) - (y.time as number)) as any);
    };
    chart.subscribeClick(onClick);
    chart.subscribeCrosshairMove(onMove);
    const ro = new ResizeObserver(() => { if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth }); });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.unsubscribeClick(onClick); chart.unsubscribeCrosshairMove(onMove); chart.remove(); chartRef.current = null; candleRef.current = null; previewRef.current = null; overlayRef.current = { series: [], lines: [] }; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, timeframe, height, fs]);

  useEffect(() => { drawOverlays(); /* eslint-disable-next-line */ }, [drawings]);

  // live last price
  useEffect(() => {
    const s = candleRef.current, bar = lastBarRef.current;
    if (!s || !bar || livePrice == null) return;
    const high = Math.max(bar.high, livePrice), low = Math.min(bar.low, livePrice);
    s.update({ time: bar.time as UTCTimestamp, open: bar.open, high, low, close: livePrice } as any);
    lastBarRef.current = { ...bar, high, low, close: livePrice };
  }, [livePrice]);

  const ToolBtn = ({ t, icon: Icon, label }: { t: Tool; icon: any; label: string }) => (
    <button onClick={() => setTool(tool === t ? null : t)} title={label}
      className={`flex items-center gap-1 px-2 py-1 rounded border ${tool === t ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-100"}`}>
      <Icon size={12} /> <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div ref={wrapRef} className={`bg-white rounded-lg border border-gray-200 ${fs ? "fixed inset-0 z-50 rounded-none" : ""}`}>
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-gray-200 text-xs flex-wrap">
        <button onClick={() => setTool(null)} title="Cursor" className={`flex items-center px-2 py-1 rounded border ${!tool ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-100"}`}><MousePointer size={12} /></button>
        <ToolBtn t="trend" icon={TrendingUp} label="Trend Line" />
        <ToolBtn t="hline" icon={Minus} label="Horizontal" />
        <ToolBtn t="hray" icon={MoveRight} label="H-Ray" />
        <div className="flex items-center gap-1 ml-1">{COLORS.map(c => <button key={c} onClick={() => setColor(c)} className={`w-4 h-4 rounded-full border-2 ${color === c ? "border-gray-800" : "border-white"}`} style={{ background: c }} />)}</div>
        <select value={width} onChange={e => setWidth(Number(e.target.value))} className="border border-gray-300 rounded px-1 py-0.5 text-gray-700" title="Line width">{[1, 2, 3, 4].map(w => <option key={w} value={w}>{w}px</option>)}</select>
        {drawings.length > 0 && <button onClick={() => persist([])} className="flex items-center gap-1 px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100" title="Clear all drawings"><Trash2 size={12} /> {drawings.length}</button>}
        {tool && <span className="text-blue-600">{hint}</span>}
        <button onClick={toggleFs} className="ml-auto flex items-center px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100" title={fs ? "Exit fullscreen" : "Fullscreen"}>{fs ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
      </div>
      {candles.length === 0
        ? <div className="flex items-center justify-center text-gray-400 text-sm" style={{ height }}>No chart data.</div>
        : <div ref={containerRef} className={`w-full ${tool ? "cursor-crosshair" : ""}`} style={{ height: fs ? "calc(100vh - 40px)" : height }} />}
    </div>
  );
}
