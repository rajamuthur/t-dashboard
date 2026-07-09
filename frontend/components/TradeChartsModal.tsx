"use client";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import LiveChartPane, { PaneConfig } from "@/components/LiveChartPane";
import { LiveSource, getSources } from "@/lib/liveSources";
import { Trade } from "@/lib/tradesApi";

interface Props {
  trade: Trade;
  onClose: () => void;
}

export default function TradeChartsModal({ trade, onClose }: Props) {
  const [sources, setSources] = useState<LiveSource[] | null>(null);
  const twoUp = trade.contract_symbol !== trade.underlying_symbol;

  const [spot, setSpot] = useState<PaneConfig>({ source: "fyers", symbol: trade.underlying_symbol, timeframe: "1d", indicators: ["volume"] });
  const [contract, setContract] = useState<PaneConfig>({ source: "fyers", symbol: trade.contract_symbol, timeframe: "1d", indicators: ["volume"] });

  useEffect(() => { getSources().then(setSources).catch(() => setSources([])); }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fyersSources = useMemo(() => (sources ?? []).filter(s => s.name === "fyers"), [sources]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[96vw] h-[88vh] bg-gray-900 border border-gray-700 rounded-lg shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
          <div className="text-sm text-gray-200">
            <span className="font-semibold text-white">{trade.symbol}</span>
            <span className="ml-2 text-gray-500">· stock vs {trade.instrument_type} contract</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex-1 min-h-0 flex gap-2 p-2">
          {fyersSources.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading charts…</div>
          ) : twoUp ? (
            <>
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="text-[11px] uppercase tracking-wider text-gray-500 px-1 pb-1">Stock · {trade.underlying}</div>
                <div className="flex-1 min-h-0"><LiveChartPane config={spot} sources={fyersSources} onChange={setSpot} /></div>
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="text-[11px] uppercase tracking-wider text-gray-500 px-1 pb-1">Contract · {trade.symbol}</div>
                <div className="flex-1 min-h-0"><LiveChartPane config={contract} sources={fyersSources} onChange={setContract} /></div>
              </div>
            </>
          ) : (
            <div className="flex-1 min-h-0"><LiveChartPane config={spot} sources={fyersSources} onChange={setSpot} /></div>
          )}
        </div>
      </div>
    </div>
  );
}
