"use client";
import { useEffect, useRef, useState } from "react";
import { getIndices, IndexQuote } from "@/lib/marketApi";

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

export default function IndexTicker() {
  const [data, setData] = useState<IndexQuote[]>([]);
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
    return <span className="text-xs text-gray-500">Loading indices…</span>;
  }

  return (
    <div className="flex items-center gap-6 text-xs">
      {data.map(ix => {
        const up = (ix.ch ?? 0) >= 0;
        const color = ix.ch == null ? "text-gray-400" : up ? "text-green-400" : "text-red-400";
        return (
          <div key={ix.symbol} className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-gray-400 font-medium">{ix.name}</span>
            <span className="font-mono text-white tabular-nums">{fmt(ix.lp)}</span>
            <span className={`font-mono tabular-nums ${color}`}>
              {ix.ch == null ? "—" : `${up ? "▲" : "▼"} ${up ? "+" : ""}${fmt(ix.ch)}`}
              {ix.chp != null && ` (${up ? "+" : ""}${fmt(ix.chp)}%)`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
