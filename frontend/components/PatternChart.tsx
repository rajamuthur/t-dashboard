"use client";
import { useEffect, useRef } from "react";
import { createChart, ColorType, CandlestickSeries, createSeriesMarkers } from "lightweight-charts";
import { Candle } from "@/lib/api";

interface Props {
  candles: Candle[];
  patternLength: number;
  entryClose?: number;
  stopLoss?: number;
  height?: number;
  markerLabels?: string[] | null;
  markerColors?: string[] | null;
  markerOffset?: number;
}

export default function PatternChart({
  candles, patternLength, entryClose, stopLoss, height = 260,
  markerLabels, markerColors, markerOffset,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || candles.length === 0) return;

    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: "#0f172a" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      width: ref.current.clientWidth,
      height,
      timeScale: { borderColor: "#334155", barSpacing: 32 },
      rightPriceScale: { borderColor: "#334155" },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#22c55e", borderDownColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
    });

    const chartData = candles.map(c => ({
      time: c.date.slice(0, 10) as `${number}-${number}-${number}`,
      open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    series.setData(chartData);

    // Markers — caller-supplied with legacy 3-candle fallback
    const labels = markerLabels ?? ["C1", "C2", "C3"];
    const colors = markerColors ?? ["#ef4444", "#ef4444", "#22c55e"];
    const offset = markerOffset ?? 0;
    const markers = candles
      .slice(offset, offset + labels.length)
      .map((c, i) => ({
        time: c.date.slice(0, 10) as `${number}-${number}-${number}`,
        position: "aboveBar" as const,
        color: colors[i] ?? "#94a3b8",
        shape: "arrowDown" as const,
        text: labels[i] ?? "",
        size: 1,
      }));
    createSeriesMarkers(series, markers);

    // SL & Entry price lines
    if (stopLoss) {
      series.createPriceLine({ price: stopLoss,   color: "#ef4444", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "SL" });
    }
    if (entryClose) {
      series.createPriceLine({ price: entryClose, color: "#22c55e", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "Entry" });
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, [candles, patternLength, entryClose, stopLoss, height, markerLabels, markerColors, markerOffset]);

  if (candles.length === 0) return (
    <div className="flex items-center justify-center text-gray-500" style={{ height }}>No candle data</div>
  );
  return <div ref={ref} className="w-full rounded-lg overflow-hidden" />;
}
