"use client";
import { useEffect, useRef } from "react";
import { createChart, ColorType, CandlestickSeries } from "lightweight-charts";
import { Candle } from "@/lib/api";

interface Props {
  candles: Candle[];
  height?: number;
}

export default function CandlestickChart({ candles, height = 400 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || candles.length === 0) return;

    const chart = createChart(ref.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#111827" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      width:  ref.current.clientWidth,
      height: height,
      timeScale: { borderColor: "#374151" },
      rightPriceScale: { borderColor: "#374151" },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor:   "#22c55e",
      downColor: "#ef4444",
      borderUpColor:   "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor:   "#22c55e",
      wickDownColor: "#ef4444",
    });

    series.setData(
      candles.map(c => ({
        time:  c.date.slice(0, 10) as `${number}-${number}-${number}`,
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
      }))
    );

    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    observer.observe(ref.current);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [candles, height]);

  if (candles.length === 0) {
    return (
      <div className="flex items-center justify-center bg-gray-900 rounded-xl border border-gray-800"
           style={{ height }}>
        <span className="text-gray-500">No candle data</span>
      </div>
    );
  }

  return <div ref={ref} className="w-full rounded-xl overflow-hidden" />;
}
