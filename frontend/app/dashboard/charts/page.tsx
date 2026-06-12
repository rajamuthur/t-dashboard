"use client";
import { useEffect, useState } from "react";
import { getSymbols, getCandles, Candle } from "@/lib/api";
import CandlestickChart from "@/components/CandlestickChart";

const TIMEFRAMES = ["week", "month", "day"];

export default function ChartsPage() {
  const [timeframe, setTimeframe] = useState("week");
  const [symbols,   setSymbols]   = useState<string[]>([]);
  const [symbol,    setSymbol]    = useState("");
  const [candles,   setCandles]   = useState<Candle[]>([]);
  const [loading,   setLoading]   = useState(false);

  useEffect(() => {
    getSymbols(timeframe).then(s => {
      setSymbols(s);
      if (s.length > 0) setSymbol(s[0]);
    }).catch(console.error);
  }, [timeframe]);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    getCandles(symbol, timeframe, 500)
      .then(setCandles).catch(console.error).finally(() => setLoading(false));
  }, [symbol, timeframe]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-white">Charts</h1>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Timeframe:</label>
          <select
            value={timeframe} onChange={e => setTimeframe(e.target.value)}
            className="bg-gray-800 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-700"
          >
            {TIMEFRAMES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Symbol:</label>
          <select
            value={symbol} onChange={e => setSymbol(e.target.value)}
            className="bg-gray-800 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-700 w-48"
          >
            {symbols.map(s => (
              <option key={s} value={s}>{s.replace("NSE:", "").replace("-EQ", "")}</option>
            ))}
          </select>
        </div>
        <span className="text-sm text-gray-500">{candles.length} candles</span>
      </div>
      {loading
        ? <div className="flex items-center justify-center h-96 text-gray-400">Loading\u2026</div>
        : <CandlestickChart candles={candles} height={480} />
      }
    </div>
  );
}
