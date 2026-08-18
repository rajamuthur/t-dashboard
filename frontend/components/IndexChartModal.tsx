"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import ChartsChart from "@/components/ChartsChart";
import { getLiveCandles } from "@/lib/liveSources";

const TIMEFRAMES = ["5m", "15m", "1h", "1d", "1wk"];
const TF_LABEL: Record<string, string> = { "5m": "5m", "15m": "15m", "1h": "1h", "1d": "1D", "1wk": "1W" };

export default function IndexChartModal({ symbol, name, onClose }: { symbol: string; name: string; onClose: () => void }) {
  const [tf, setTf] = useState("1d");
  const [candles, setCandles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getLiveCandles("fyers", symbol, tf, 400)
      .then(c => { if (alive) setCandles(c); })
      .catch(() => { if (alive) setCandles([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol, tf]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-4xl bg-gray-900 border border-gray-700 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-white">{name}</h2>
            <div className="flex items-center rounded-lg border border-gray-700 overflow-hidden text-xs">
              {TIMEFRAMES.map(t => (
                <button key={t} onClick={() => setTf(t)}
                  className={`px-2 py-1 ${tf === t ? "bg-brand-600 text-white" : "bg-gray-800 text-gray-300 hover:text-white"}`}>
                  {TF_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-3">
          {loading
            ? <div className="h-[480px] flex items-center justify-center text-gray-500 text-sm">Loading chart…</div>
            : candles.length
              ? <ChartsChart candles={candles} symbol={symbol} timeframe={tf} height={480} lsPrefix="indexdraw" />
              : <div className="h-[480px] flex items-center justify-center text-gray-500 text-sm bg-white rounded">No chart data.</div>}
        </div>
      </div>
    </div>
  );
}
