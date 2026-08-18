"use client";
import { useEffect, useRef, useState } from "react";
import { getIndices, IndexQuote } from "@/lib/marketApi";
import IndexChartModal from "@/components/IndexChartModal";

function fmt(n: number | null, d = 2): string {
  return n == null ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

// NSE session-ish window in IST (Mon–Fri, 09:15–16:00). getTimezoneOffset() is in
// minutes; +330 shifts local → IST regardless of the browser's timezone.
function inMarketHoursIST(): boolean {
  const now = new Date();
  const ist = new Date(now.getTime() + (now.getTimezoneOffset() + 330) * 60000);
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 9 * 60 + 15 && mins <= 16 * 60;
}

export default function IndexTicker({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<IndexQuote[]>([]);
  const [charting, setCharting] = useState<{ symbol: string; name: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await getIndices();
        if (alive) setData(r.indices);
      } catch { /* keep last values */ }
    }
    function schedule() {
      const ms = inMarketHoursIST() ? 15_000 : 120_000;  // live during hours, idle after
      timer.current = window.setTimeout(async () => { await load(); schedule(); }, ms);
    }
    load();
    schedule();
    return () => { alive = false; if (timer.current) window.clearTimeout(timer.current); };
  }, []);

  if (data.length === 0) {
    return <span className="text-[11px] text-gray-500">Loading indices…</span>;
  }

  const modal = charting && (
    <IndexChartModal symbol={charting.symbol} name={charting.name} onClose={() => setCharting(null)} />
  );

  // Compact: vertical stack for the narrow sidebar (name + value, change below).
  if (compact) {
    return (
      <>
        <div className="space-y-1">
          {data.map(ix => {
            const up = (ix.ch ?? 0) >= 0;
            const color = ix.ch == null ? "text-gray-400" : up ? "text-green-400" : "text-red-400";
            return (
              <button key={ix.symbol} onClick={() => setCharting({ symbol: ix.symbol, name: ix.name })}
                title={`Chart ${ix.name}`}
                className="w-full text-[11px] leading-tight rounded px-1 py-0.5 hover:bg-gray-800/70 transition">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-gray-400 font-medium">{ix.name}</span>
                  <span className="font-mono tabular-nums text-white">{fmt(ix.lp)}</span>
                </div>
                <div className={`text-right font-mono tabular-nums ${color}`}>
                  {ix.ch == null ? "—" : `${up ? "▲" : "▼"} ${up ? "+" : ""}${fmt(ix.ch)}`}
                  {ix.chp != null && ` (${up ? "+" : ""}${fmt(ix.chp)}%)`}
                </div>
              </button>
            );
          })}
        </div>
        {modal}
      </>
    );
  }

  return (
    <div className="flex items-center gap-6 text-xs">
      {data.map(ix => {
        const up = (ix.ch ?? 0) >= 0;
        const color = ix.ch == null ? "text-gray-400" : up ? "text-green-400" : "text-red-400";
        return (
          <button key={ix.symbol} onClick={() => setCharting({ symbol: ix.symbol, name: ix.name })}
            title={`Chart ${ix.name}`}
            className="flex items-center gap-2 whitespace-nowrap hover:opacity-80">
            <span className="text-gray-400 font-medium">{ix.name}</span>
            <span className="font-mono text-white tabular-nums">{fmt(ix.lp)}</span>
            <span className={`font-mono tabular-nums ${color}`}>
              {ix.ch == null ? "—" : `${up ? "▲" : "▼"} ${up ? "+" : ""}${fmt(ix.ch)}`}
              {ix.chp != null && ` (${up ? "+" : ""}${fmt(ix.chp)}%)`}
            </span>
          </button>
        );
      })}
      {modal}
    </div>
  );
}
