"use client";
import { useEffect, useState } from "react";
import { getScansV2, ScanResultFull } from "@/lib/api";

interface Card { label: string; value: number; color: string }

export default function DashboardHome() {
  const [weekly,  setWeekly]  = useState<ScanResultFull[]>([]);
  const [monthly, setMonthly] = useState<ScanResultFull[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getScansV2({ timeframe: "week",  matched_only: true, limit: 10, sort_by: "candle_date", sort_dir: "desc" }),
      getScansV2({ timeframe: "month", matched_only: true, limit: 10, sort_by: "candle_date", sort_dir: "desc" }),
    ]).then(([w, m]) => { setWeekly(w.data); setMonthly(m.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const cards: Card[] = [
    { label: "Weekly Signals",  value: weekly.length,  color: "text-blue-400"   },
    { label: "Monthly Signals", value: monthly.length, color: "text-purple-400" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Overview</h1>
      <div className="grid grid-cols-2 gap-4">
        {cards.map(c => (
          <div key={c.label} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
            <p className="text-sm text-gray-400">{c.label}</p>
            {loading
              ? <div className="h-9 w-12 mt-1 bg-gray-700 rounded animate-pulse" />
              : <p className={`text-3xl font-bold mt-1 ${c.color}`}>{c.value}</p>
            }
          </div>
        ))}
      </div>
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">Latest Weekly Signals</h2>
        {loading ? (
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">Entry</th>
                  <th className="px-4 py-3 font-medium text-right">SL</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-gray-800 animate-pulse">
                    <td className="px-4 py-3"><div className="h-4 bg-gray-700 rounded w-20" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-700 rounded w-24" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-700 rounded w-16 ml-auto" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-700 rounded w-16 ml-auto" /></td>
                    <td className="px-4 py-3"><div className="h-5 bg-gray-700 rounded-full w-14" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">Entry</th>
                  <th className="px-4 py-3 font-medium text-right">SL</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {weekly.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No weekly signals</td></tr>
                ) : weekly.map((r, i) => (
                  <tr key={i} className="border-t border-gray-800 hover:bg-gray-800/50">
                    <td className="px-4 py-3 font-semibold text-white">{r.symbol.replace("NSE:", "").replace("-EQ", "")}</td>
                    <td className="px-4 py-3 text-gray-400">{r.candle_date?.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-right text-green-400 font-mono">{r.details?.entry_close?.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-red-400 font-mono">{r.details?.stop_loss?.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      {r.outcome ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          r.outcome === "success" ? "bg-green-900/60 text-green-400" :
                          r.outcome === "failure" ? "bg-red-900/60 text-red-400" :
                          r.outcome === "pending" ? "bg-yellow-900/60 text-yellow-400" :
                          "bg-gray-800 text-gray-400"
                        }`}>{r.outcome}</span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
