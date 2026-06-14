"use client";
import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  createChart, ColorType, CandlestickSeries, LineSeries, createSeriesMarkers,
  IChartApi, UTCTimestamp, LineStyle,
} from "lightweight-charts";

export interface PatternCandle {
  date: string; open: number; high: number; low: number; close: number; volume: number;
}
export interface PatternShape {
  type: "marker" | "hline" | "trendline" | "polyline";
  color?: string;
  label?: string;
  // marker
  date?: string; price?: number; text?: string; position?: "aboveBar" | "belowBar";
  // trendline / polyline
  points?: { date: string; price: number }[];
}

interface Props {
  candles: PatternCandle[];
  shapes: PatternShape[];
  height?: number;
}

export default function PatternShapeChart({ candles, shapes, height = 320 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [fs, setFs] = useState(false);

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
    // Let the chart fill the new size.
    setTimeout(() => {
      if (chartRef.current && ref.current) {
        chartRef.current.applyOptions({ width: ref.current.clientWidth, height: ref.current.clientHeight });
        chartRef.current.timeScale().fitContent();
      }
    }, 120);
  }

  useEffect(() => {
    if (!ref.current || candles.length === 0) return;

    const chart: IChartApi = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#334155" },
      grid: { vertLines: { color: "#e2e8f0" }, horzLines: { color: "#e2e8f0" } },
      width: ref.current.clientWidth,
      height,
      timeScale: { borderColor: "#cbd5e1", timeVisible: false },
      rightPriceScale: { borderColor: "#cbd5e1" },
      crosshair: { mode: 1 },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a", downColor: "#dc2626",
      borderUpColor: "#16a34a", borderDownColor: "#dc2626",
      wickUpColor: "#16a34a", wickDownColor: "#dc2626",
    });
    candleSeries.setData(candles.map(c => ({
      time: c.date as unknown as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
    })) as any);

    // Trendlines / polylines → 2+ point line series.
    for (const s of shapes) {
      if ((s.type === "trendline" || s.type === "polyline") && s.points?.length) {
        const ls = chart.addSeries(LineSeries, {
          color: s.color ?? "#a855f7", lineWidth: 2,
          lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
        });
        const pts = [...s.points].sort((a, b) => (a.date < b.date ? -1 : 1));
        ls.setData(pts.map(p => ({ time: p.date as unknown as UTCTimestamp, value: p.price })) as any);
      }
    }

    // Horizontal entry/stop/target lines on the candle series.
    for (const s of shapes) {
      if (s.type === "hline" && s.price != null) {
        candleSeries.createPriceLine({
          price: s.price, color: s.color ?? "#64748b",
          lineWidth: 1, lineStyle: LineStyle.Dashed,
          axisLabelVisible: true, title: s.label ?? "",
        });
      }
    }

    // Markers (e.g. C1/C2/C3 for star patterns).
    const markers = shapes
      .filter(s => s.type === "marker" && s.date)
      .map(s => ({
        time: s.date as unknown as UTCTimestamp,
        position: (s.position ?? "aboveBar") as "aboveBar" | "belowBar",
        color: s.color ?? "#334155",
        shape: "circle" as const,
        text: s.text ?? "",
      }));
    if (markers.length) createSeriesMarkers(candleSeries, markers as any);

    chartRef.current = chart;
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth, height: ref.current.clientHeight });
    });
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [candles, shapes, height]);

  if (candles.length === 0) {
    return <div className="flex items-center justify-center text-gray-500 bg-white rounded-lg" style={{ height }}>No candle data</div>;
  }
  return (
    <div ref={wrapRef} className={`relative bg-white rounded-lg overflow-hidden border border-gray-200 ${fs ? "fixed inset-0 z-50 rounded-none" : ""}`}>
      <button
        type="button"
        onClick={toggleFullscreen}
        className="absolute top-2 right-2 z-10 p-1.5 rounded bg-white/90 border border-gray-300 text-gray-600 hover:text-gray-900 shadow-sm"
        title={fs ? "Exit full view" : "Full view"}
      >
        {fs ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
      <div ref={ref} className="w-full" style={{ height: fs ? "100vh" : height }} />
    </div>
  );
}
