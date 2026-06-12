"use client";
import { useEffect, useState, useCallback } from "react";
import { getScans, getAnalysisTypes, ScanResult } from "@/lib/api";
import SignalTable from "@/components/SignalTable";
import SyncStatus from "@/components/SyncStatus";

export default function DailyPage() {
  const [results,  setResults]  = useState<ScanResult[]>([]);
  const [types,    setTypes]    = useState<string[]>([]);
  const [selType,  setSelType]  = useState("3candle_reversal");
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    getScans({ timeframe: "day", analysis_type: selType, matched_only: true })
      .then(setResults).catch(console.error).finally(() => setLoading(false));
  }, [selType]);

  useEffect(() => { getAnalysisTypes().then(setTypes).catch(console.error); }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Daily Signals</h1>
        <SyncStatus timeframe="day" onSyncComplete={load} />
      </div>
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-400">Pattern:</label>
        <select value={selType} onChange={e => setSelType(e.target.value)}
          className="bg-gray-800 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-700">
          {types.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </select>
        <span className="text-sm text-gray-500">{results.length} match{results.length !== 1 ? "es" : ""}</span>
      </div>
      <SignalTable results={results} loading={loading} />
    </div>
  );
}
