"use client";
import { useEffect, useRef } from "react";
import {
  createChart, ColorType, CandlestickSeries, LineSeries, createSeriesMarkers,
  IChartApi, ISeriesApi, IPriceLine, UTCTimestamp, LineStyle,
} from "lightweight-charts";
import { AlertRow } from "@/lib/alertsApi";

export interface Candle { date: string; open: number; high: number; low: number; close: number; volume: number; }

interface Props {
  candles: Candle[];
  alerts: AlertRow[];
  drawMode: null | "horizontal" | "trend";
  timeframe: string;
  onPlaceHorizontal: (price: number) => void;
  onPlaceTrend: (a: { t1: number; p1: number; t2: number; p2: number }) => void;
  height?: number;
}

function toTime(d: string): number {
  return Math.floor(Date.parse(d.includes(" ") ? d.replace(" ", "T") : d) / 1000);
}

export default function AlertChart({ candles, alerts, drawMode, timeframe, onPlaceHorizontal, onPlaceTrend, height = 460 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlayRef = useRef<{ series: ISeriesApi<any>[]; lines: IPriceLine[] }>({ series: [], lines: [] });
  const drawRef = useRef(drawMode);
  const pendingRef = useRef<{ t: number; p: number } | null>(null);
  const cbRef = useRef({ onPlaceHorizontal, onPlaceTrend });

  useEffect(() => { cbRef.current = { onPlaceHorizontal, onPlaceTrend }; });
  useEffect(() => { drawRef.current = drawMode; if (!drawMode) { pendingRef.current = null; drawMarkers(); } }, [drawMode]);

  function drawMarkers() {
    const s = seriesRef.current; if (!s) return;
    const p = pendingRef.current;
    createSeriesMarkers(s, p ? [{ time: p.t as UTCTimestamp, position: "inBar", color: "#3b82f6", shape: "circle", text: "A" }] : []);
  }

  function clearOverlays() {
    const chart = chartRef.current, s = seriesRef.current;
    overlayRef.current.series.forEach(ser => { try { chart?.removeSeries(ser); } catch {} });
    overlayRef.current.lines.forEach(l => { try { s?.removePriceLine(l); } catch {} });
    overlayRef.current = { series: [], lines: [] };
  }

  function drawOverlays() {
    const chart = chartRef.current, s = seriesRef.current;
    if (!chart || !s || candles.length === 0) return;
    clearOverlays();
    const lastT = toTime(candles[candles.length - 1].date);
    for (const a of alerts) {
      const color = a.condition === "cross_up" ? "#22c55e" : "#ef4444";
      const dim = a.status !== "active";
      if (a.kind === "horizontal" && a.price != null) {
        overlayRef.current.lines.push(s.createPriceLine({
          price: a.price, color: dim ? "#64748b" : color, lineWidth: 2,
          lineStyle: dim ? LineStyle.Dotted : LineStyle.Solid, axisLabelVisible: true,
          title: (a.name || "alert") + (dim ? " ✓" : ""),
        }));
      } else if (a.kind === "trend" && a.t1 != null && a.p1 != null && a.t2 != null && a.p2 != null && a.timeframe === timeframe) {
        const pts = [{ time: a.t1 as UTCTimestamp, value: a.p1 }, { time: a.t2 as UTCTimestamp, value: a.p2 }].sort((x, y) => (x.time as number) - (y.time as number));
        // Extend to the right edge along the line.
        if (a.t2 !== a.t1 && lastT > (pts[1].time as number)) {
          const slope = (a.p2 - a.p1) / (a.t2 - a.t1);
          pts.push({ time: lastT as UTCTimestamp, value: a.p1 + slope * (lastT - a.t1) });
        }
        const ls = chart.addSeries(LineSeries, { color: dim ? "#64748b" : color, lineWidth: 2, lineStyle: dim ? LineStyle.Dotted : LineStyle.Solid, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
        ls.setData(pts as any);
        overlayRef.current.series.push(ls);
      }
    }
  }

  // Create chart once per candle set.
  useEffect(() => {
    if (!wrapRef.current || candles.length === 0) return;
    const chart = createChart(wrapRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#334155" },
      grid: { vertLines: { color: "#e2e8f0" }, horzLines: { color: "#e2e8f0" } },
      width: wrapRef.current.clientWidth, height,
      timeScale: { borderColor: "#cbd5e1", timeVisible: timeframe.endsWith("m") || timeframe === "1h", secondsVisible: false },
      rightPriceScale: { borderColor: "#cbd5e1" },
      crosshair: { mode: 1 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a", downColor: "#dc2626", borderUpColor: "#16a34a", borderDownColor: "#dc2626",
      wickUpColor: "#16a34a", wickDownColor: "#dc2626",
    });
    series.setData(candles.map(c => ({ time: toTime(c.date) as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })) as any);
    chartRef.current = chart; seriesRef.current = series;
    chart.timeScale().fitContent();
    drawOverlays();

    const clickSub = (param: any) => {
      const mode = drawRef.current;
      if (!mode || !param.point) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price == null) return;
      const t = (typeof param.time === "number" ? param.time : chart.timeScale().coordinateToTime(param.point.x)) as number | null;
      if (mode === "horizontal") { cbRef.current.onPlaceHorizontal(Number(price)); return; }
      // trend: two clicks
      if (t == null) return;
      if (!pendingRef.current) { pendingRef.current = { t, p: Number(price) }; drawMarkers(); }
      else {
        const a = pendingRef.current;
        cbRef.current.onPlaceTrend({ t1: a.t, p1: a.p, t2: t, p2: Number(price) });
        pendingRef.current = null; drawMarkers();
      }
    };
    chart.subscribeClick(clickSub);

    const ro = new ResizeObserver(() => { if (wrapRef.current) chart.applyOptions({ width: wrapRef.current.clientWidth }); });
    ro.observe(wrapRef.current);
    return () => { ro.disconnect(); chart.unsubscribeClick(clickSub); chart.remove(); chartRef.current = null; seriesRef.current = null; overlayRef.current = { series: [], lines: [] }; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, height, timeframe]);

  // Redraw overlays when alerts change (without rebuilding the chart).
  useEffect(() => { drawOverlays(); /* eslint-disable-next-line */ }, [alerts]);

  if (candles.length === 0) {
    return <div className="flex items-center justify-center bg-white rounded-lg text-gray-500 text-sm" style={{ height }}>No chart data for this symbol / timeframe.</div>;
  }
  return (
    <div className="relative">
      <div ref={wrapRef} className={`w-full rounded-lg overflow-hidden border ${drawMode ? "border-brand-500 ring-1 ring-brand-500/40 cursor-crosshair" : "border-gray-200"}`} style={{ height }} />
      {drawMode && (
        <div className="absolute top-2 left-2 z-10 text-[11px] bg-brand-600 text-white px-2 py-1 rounded shadow">
          {drawMode === "horizontal" ? "Click the chart to place a horizontal line" : pendingRef.current ? "Click point B" : "Click point A, then point B"}
        </div>
      )}
    </div>
  );
}
