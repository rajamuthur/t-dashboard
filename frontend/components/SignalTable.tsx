"use client";
import { ScanResult } from "@/lib/api";

interface Props {
  results: ScanResult[];
  loading?: boolean;
}

export default function SignalTable({ results, loading }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        Loading\u2026
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No signals found for this period.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-800 text-gray-400 text-left">
            <th className="px-4 py-3 font-medium">Symbol</th>
            <th className="px-4 py-3 font-medium">Pattern</th>
            <th className="px-4 py-3 font-medium">Candle Date</th>
            <th className="px-4 py-3 font-medium text-right">Entry Close</th>
            <th className="px-4 py-3 font-medium text-right">Stop Loss</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr
              key={`${r.symbol}-${r.analysis_type}-${i}`}
              className="border-t border-gray-800 hover:bg-gray-800/50 transition"
            >
              <td className="px-4 py-3 font-semibold text-white">
                {r.symbol.replace("NSE:", "").replace("-EQ", "")}
              </td>
              <td className="px-4 py-3 text-gray-300">
                {r.analysis_type.replace(/_/g, " ")}
              </td>
              <td className="px-4 py-3 text-gray-400">
                {r.candle_date ? r.candle_date.slice(0, 10) : "\u2014"}
              </td>
              <td className="px-4 py-3 text-right text-green-400 font-mono">
                {r.details?.entry_close?.toFixed(2) ?? "\u2014"}
              </td>
              <td className="px-4 py-3 text-right text-red-400 font-mono">
                {r.details?.stop_loss?.toFixed(2) ?? "\u2014"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
