"use client";
import { useEffect, useRef, useCallback } from "react";
import { createChart, ColorType, CandlestickSeries, createSeriesMarkers } from "lightweight-charts";
import { X, TrendingUp, TrendingDown, Clock, Minus } from "lucide-react";
import { ScanResultFull, ScanDetail } from "@/lib/api";
import OutcomeBadge from "@/components/OutcomeBadge";

interface Props {
  item: ScanResultFull;
  detail: ScanDetail;
  onClose: () => void;
}

function OutcomeChart({ detail, item }: { detail: ScanDetail; item: ScanResultFull }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || detail.candles.length === 0) return;

    const chart = createChart(ref.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0f172a" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      width: ref.current.clientWidth,
      height: 340,
      timeScale: { borderColor: "#334155", barSpacing: 40 },
      rightPriceScale: { borderColor: "#334155" },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#22c55e", borderDownColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
    });

    const chartData = detail.candles.map(c => ({
      time: c.date.slice(0, 10) as `${number}-${number}-${number}`,
      open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    series.setData(chartData);

    // Pattern markers — scanner-supplied metadata with legacy 3-candle fallback
    const patternLabels = detail.marker_labels ?? ["C1", "C2", "C3"];
    const patternColors = detail.marker_colors ?? ["#ef4444", "#f97316", "#22c55e"];
    const markerOffset  = detail.marker_offset ?? 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const markers: any[] = [];

    detail.candles
      .slice(markerOffset, markerOffset + patternLabels.length)
      .forEach((c, i) => {
        markers.push({
          time: c.date.slice(0, 10) as `${number}-${number}-${number}`,
          position: "aboveBar",
          color: patternColors[i] ?? "#94a3b8",
          shape: "arrowDown",
          text: patternLabels[i] ?? "",
          size: 1,
        });
      });

    // Outcome marker on the trigger candle
    const entry   = item.details?.entry_close;
    const sl      = item.details?.stop_loss;
    const outcome = item.outcome;
    const outDate = item.outcome_date;

    if (outDate && (outcome === "success" || outcome === "failure")) {
      markers.push({
        time: outDate.slice(0, 10) as `${number}-${number}-${number}`,
        position: outcome === "success" ? "belowBar" : "aboveBar",
        color: outcome === "success" ? "#22c55e" : "#ef4444",
        shape: outcome === "success" ? "arrowUp" : "arrowDown",
        text: outcome === "success" ? "✓ WIN" : "✗ SL",
        size: 2,
      });
    }

    createSeriesMarkers(series, markers);

    // Price lines
    if (sl) {
      series.createPriceLine({
        price: sl, color: "#ef4444", lineWidth: 1,
        lineStyle: 2, axisLabelVisible: true, title: "SL",
      });
    }
    if (entry) {
      series.createPriceLine({
        price: entry, color: "#22c55e", lineWidth: 1,
        lineStyle: 2, axisLabelVisible: true, title: "Entry",
      });
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, [detail, item]);

  return <div ref={ref} className="w-full rounded-lg overflow-hidden" />;
}

export default function OutcomeModal({ item, detail, onClose }: Props) {
  // Close on backdrop click or Escape
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  const entry  = item.details?.entry_close;
  const sl     = item.details?.stop_loss;
  const risk   = entry && sl ? Math.abs(entry - sl) : null;
  const riskPct = entry && risk ? ((risk / entry) * 100).toFixed(2) : null;
  const sym    = item.symbol.replace("NSE:", "").replace("-EQ", "");

  const outcomeIcon =
    item.outcome === "success" ? <TrendingUp  size={18} className="text-green-400" /> :
    item.outcome === "failure" ? <TrendingDown size={18} className="text-red-400"  /> :
    item.outcome === "pending" ? <Clock size={18} className="text-yellow-400" /> :
                                 <Minus size={18} className="text-gray-400" />;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            {outcomeIcon}
            <span className="text-xl font-bold text-white">{sym}</span>
            <span className="text-sm text-gray-400">{item.timeframe === "week" ? "Weekly" : "Monthly"}</span>
            <OutcomeBadge outcome={item.outcome ?? null} />
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-800 border-b border-gray-800">
          {[
            { label: "Signal Date",    value: item.candle_date?.slice(0, 10) ?? "—" },
            { label: "Entry Price",    value: entry   ? `₹${entry.toFixed(2)}`   : "—", cls: "text-green-400" },
            { label: "Stop Loss",      value: sl      ? `₹${sl.toFixed(2)}`      : "—", cls: "text-red-400"   },
            { label: "Risk",           value: risk    ? `₹${risk.toFixed(2)} (${riskPct}%)` : "—", cls: "text-gray-300" },
            { label: "Outcome Date",   value: item.outcome_date?.slice(0, 10) ?? "—" },
            { label: "Outcome Price",  value: item.outcome_price ? `₹${item.outcome_price.toFixed(2)}` : "—",
              cls: item.outcome === "success" ? "text-green-400" : item.outcome === "failure" ? "text-red-400" : "" },
            { label: "Pattern",        value: item.analysis_type?.replace(/_/g, " ") ?? "—" },
            { label: "Next Candles",   value: `${detail.candles.length - detail.pattern_length} available` },
          ].map(s => (
            <div key={s.label} className="bg-gray-900 px-4 py-3">
              <div className="text-xs text-gray-500 mb-0.5">{s.label}</div>
              <div className={`text-sm font-semibold ${s.cls ?? "text-white"}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Pattern legend — scanner-provided with legacy 3-candle fallback */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 pt-4 text-xs text-gray-400">
          {(detail.legend ?? [
            { label: "C1", color: "#ef4444", text: "Red bearish (body >10%)" },
            { label: "C2", color: "#f97316", text: "Red, lower wick ≤15%"     },
            { label: "C3", color: "#22c55e", text: "Green, low ≥ C2 low"      },
          ]).map(l => (
            <span key={l.label}>
              <span className="font-medium" style={{ color: l.color }}>{l.label}</span>
              {" = "}{l.text}
            </span>
          ))}
          {item.outcome === "success" && <span><span className="text-green-400 font-medium">✓ WIN</span> = Close &gt; Entry</span>}
          {item.outcome === "failure" && <span><span className="text-red-400 font-medium">✗ SL</span> = Low &lt; Stop Loss</span>}
        </div>

        {/* Chart */}
        <div className="px-6 py-4">
          <OutcomeChart detail={detail} item={item} />
        </div>

        {/* Subsequent candle OHLC table */}
        {detail.candles.length > detail.pattern_length && (
          <div className="px-6 pb-6">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Post-Signal Candles
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    {["#","Date","Open","High","Low","Close","vs Entry","vs SL"].map(h => (
                      <th key={h} className="py-2 px-2 text-right first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail.candles.slice(detail.pattern_length).map((c, i) => {
                    const hitSL  = sl    ? c.low   < sl    : false;
                    const hitTgt = entry ? c.close > entry : false;
                    const rowCls = hitSL  ? "bg-red-950/30" :
                                   hitTgt ? "bg-green-950/30" : "";
                    const vEntry = entry ? ((c.close - entry) / entry * 100).toFixed(1) : "—";
                    const vSL    = sl    ? ((c.close - sl)    / sl    * 100).toFixed(1) : "—";
                    return (
                      <tr key={i} className={`border-b border-gray-800/50 ${rowCls}`}>
                        <td className="py-1.5 px-2 text-gray-400">N{i + 1}</td>
                        <td className="py-1.5 px-2 text-right text-gray-300">{c.date.slice(0,10)}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{c.open.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-green-400">{c.high.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-red-400">{c.low.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right font-mono font-semibold">{c.close.toFixed(2)}</td>
                        <td className={`py-1.5 px-2 text-right font-mono ${parseFloat(vEntry) >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {vEntry !== "—" ? `${parseFloat(vEntry) >= 0 ? "+" : ""}${vEntry}%` : "—"}
                        </td>
                        <td className={`py-1.5 px-2 text-right font-mono ${parseFloat(vSL) >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {vSL !== "—" ? `${parseFloat(vSL) >= 0 ? "+" : ""}${vSL}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {detail.candles.length <= detail.pattern_length && (
          <div className="mx-6 mb-6 flex items-center gap-2 text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-800 rounded px-3 py-2">
            <span className="animate-pulse">●</span>
            Next {item.timeframe === "week" ? "weekly" : "monthly"} candle not yet closed
          </div>
        )}
      </div>
    </div>
  );
}
