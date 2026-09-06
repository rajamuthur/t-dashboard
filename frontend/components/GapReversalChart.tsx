"use client";
import { useEffect, useRef } from "react";
import {
  createChart, ColorType, CandlestickSeries, LineSeries, HistogramSeries, BaselineSeries,
  createSeriesMarkers, LineStyle, IChartApi,
} from "lightweight-charts";

interface Candle { date: string; open: number; high: number; low: number; close: number; volume: number; }
interface RsiPt { date: string; rsi: number | null; rsi_ma: number | null; }
interface Props {
  candles: Candle[];
  shapes: any[];                                   // polyline (EMA) + markers (L/S)
  rsi: RsiPt[];
  bands?: { upper: number; middle: number; lower: number };
  height?: number;
}

const toTime = (d: string) => Math.floor(Date.parse(d.includes(" ") ? d.replace(" ", "T") : d) / 1000);
const NO_SCALE = () => null;

// Two stacked charts (price + RSI) with synced time axes — reliable across the
// lightweight-charts panes quirks. A fixed price-axis width keeps them aligned.
export default function GapReversalChart({ candles, shapes, rsi, bands, height = 460 }: Props) {
  const priceRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!priceRef.current || !rsiRef.current || candles.length === 0) return;
    const rsiH = Math.round(height * 0.34);
    const priceH = height - rsiH;
    const common = {
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#334155", fontSize: 11 },
      grid: { vertLines: { color: "#eef2f7" }, horzLines: { color: "#eef2f7" } },
      rightPriceScale: { borderColor: "#cbd5e1", minimumWidth: 58 },
      crosshair: { mode: 0 as any },
    };

    const cp = createChart(priceRef.current, {
      ...common, width: priceRef.current.clientWidth, height: priceH,
      timeScale: { borderColor: "#cbd5e1", visible: false, rightOffset: 4 },
    });
    const candle = cp.addSeries(CandlestickSeries, {
      upColor: "#16a34a", downColor: "#dc2626", borderUpColor: "#16a34a",
      borderDownColor: "#dc2626", wickUpColor: "#16a34a", wickDownColor: "#dc2626",
    });
    candle.setData(candles.map(c => ({ time: toTime(c.date) as any, open: c.open, high: c.high, low: c.low, close: c.close })));
    const vol = cp.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volq" });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    vol.setData(candles.map(c => ({ time: toTime(c.date) as any, value: c.volume || 0, color: c.close >= c.open ? "rgba(22,163,74,0.3)" : "rgba(220,38,38,0.3)" })));
    const emaShape = shapes.find(s => s.type === "polyline");
    if (emaShape?.points?.length) {
      const es = cp.addSeries(LineSeries, { color: emaShape.color || "#2563eb", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      es.setData(emaShape.points.map((p: any) => ({ time: toTime(p.date) as any, value: p.price })));
    }
    const markers = shapes.filter(s => s.type === "marker").map((m: any) => ({
      time: toTime(m.date) as any, position: m.position === "belowBar" ? "belowBar" : "aboveBar",
      color: m.color, shape: m.position === "belowBar" ? "arrowUp" : "arrowDown", text: m.text || "",
    })).sort((a: any, b: any) => a.time - b.time);
    if (markers.length) createSeriesMarkers(candle, markers as any);

    const cr = createChart(rsiRef.current, {
      ...common, width: rsiRef.current.clientWidth, height: rsiH,
      timeScale: { borderColor: "#cbd5e1", visible: true, rightOffset: 4 },
    });
    const b = bands || { upper: 90, middle: 50, lower: 10 };
    const rsiData = rsi.filter(r => r.rsi != null).map(r => ({ time: toTime(r.date) as any, value: r.rsi as number }));
    const clear = "rgba(0,0,0,0)";

    // Overbought fill (green above the upper band) — a baseline whose only visible
    // part is the fill above the band; the line itself is hidden.
    const obFill = cr.addSeries(BaselineSeries, {
      baseValue: { type: "price", price: b.upper },
      topLineColor: clear, topFillColor1: "rgba(34,197,94,0.45)", topFillColor2: "rgba(34,197,94,0.04)",
      bottomLineColor: clear, bottomFillColor1: clear, bottomFillColor2: clear,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    });
    obFill.setData(rsiData);
    // Oversold fill (red below the lower band).
    const osFill = cr.addSeries(BaselineSeries, {
      baseValue: { type: "price", price: b.lower },
      topLineColor: clear, topFillColor1: clear, topFillColor2: clear,
      bottomLineColor: clear, bottomFillColor1: "rgba(239,68,68,0.04)", bottomFillColor2: "rgba(239,68,68,0.5)",
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      autoscaleInfoProvider: NO_SCALE,
    });
    osFill.setData(rsiData);

    const rsiLine = cr.addSeries(LineSeries, {
      color: "#7c3aed", lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
      autoscaleInfoProvider: NO_SCALE,
    });
    rsiLine.setData(rsiData);
    rsiLine.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.06 } });
    const rsiMa = cr.addSeries(LineSeries, { color: "#eab308", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: NO_SCALE });
    rsiMa.setData(rsi.filter(r => r.rsi_ma != null).map(r => ({ time: toTime(r.date) as any, value: r.rsi_ma as number })));
    [{ v: b.upper, c: "#ef4444" }, { v: b.middle, c: "#94a3b8" }, { v: b.lower, c: "#22c55e" }].forEach(x =>
      rsiLine.createPriceLine({ price: x.v, color: x.c, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: String(x.v) }));

    // Sync the two time axes.
    let syncing = false;
    const link = (a: IChartApi, other: IChartApi) => a.timeScale().subscribeVisibleLogicalRangeChange(r => {
      if (syncing || !r) return; syncing = true;
      try { other.timeScale().setVisibleLogicalRange(r); } catch {} syncing = false;
    });
    link(cp, cr); link(cr, cp);
    cp.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      const w = priceRef.current?.clientWidth || 0;
      cp.applyOptions({ width: w }); cr.applyOptions({ width: w });
    });
    ro.observe(priceRef.current);
    return () => { ro.disconnect(); cp.remove(); cr.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, shapes, rsi, bands, height]);

  if (candles.length === 0) return <div className="text-gray-500 text-xs">No chart data.</div>;
  return (
    <div className="rounded-lg overflow-hidden border border-gray-200 bg-white" style={{ height }}>
      <div ref={priceRef} className="w-full" />
      <div ref={rsiRef} className="w-full" />
    </div>
  );
}
