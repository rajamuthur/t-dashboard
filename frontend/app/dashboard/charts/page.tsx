"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import ChartsChart from "@/components/ChartsChart";
import { getLiveCandles, LiveCandle } from "@/lib/liveSources";
import { getChartUniverses, getUniverseSymbols, getChartQuotes, ChartUniverse, ChartQuote } from "@/lib/chartsApi";

const TIMEFRAMES: [string, string][] = [["5m", "5m"], ["15m", "15m"], ["1h", "1h"], ["1d", "1D"], ["1wk", "1W"], ["1mo", "1M"]];
type SortKey = "symbol" | "lp" | "ch" | "chp";
const short = (s: string) => s.replace("NSE:", "").replace("-EQ", "").replace("-INDEX", "");
const inr = (n?: number | null) => (n == null || Number.isNaN(n) ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));
const chgColor = (n?: number | null) => (n == null || n === 0 ? "text-gray-500" : n > 0 ? "text-green-600" : "text-red-600");

export default function ChartsPage() {
  const [universes, setUniverses] = useState<ChartUniverse[]>([]);
  const [universe, setUniverse] = useState("fo");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<Record<string, ChartQuote>>({});
  const [selected, setSelected] = useState("");
  const [timeframe, setTimeframe] = useState("1d");
  const [candles, setCandles] = useState<LiveCandle[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("chp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sortedRef = useRef<string[]>([]);
  const selRef = useRef(selected); selRef.current = selected;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { getChartUniverses().then(setUniverses).catch(() => {}); }, []);

  // load universe symbols
  useEffect(() => {
    let alive = true;
    getUniverseSymbols(universe).then(s => { if (!alive) return; setSymbols(s); setSelected(prev => (s.includes(prev) ? prev : s[0] || "")); }).catch(() => setSymbols([]));
    return () => { alive = false; };
  }, [universe]);

  // realtime quotes for the list (poll while tab visible)
  useEffect(() => {
    if (symbols.length === 0) { setQuotes({}); return; }
    let alive = true;
    async function poll() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try { const q = await getChartQuotes(symbols); if (alive) setQuotes(q); } catch {}
    }
    poll();
    const id = window.setInterval(poll, 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, [symbols]);

  // candles for selected symbol / timeframe
  useEffect(() => {
    if (!selected) { setCandles([]); return; }
    let alive = true; setLoadingChart(true);
    getLiveCandles("fyers", selected, timeframe, 400).then(c => { if (alive) setCandles(c); }).catch(() => { if (alive) setCandles([]); }).finally(() => { if (alive) setLoadingChart(false); });
    return () => { alive = false; };
  }, [selected, timeframe]);

  const sorted = useMemo(() => {
    const val = (s: string): string | number => sortKey === "symbol" ? short(s) : (quotes[s]?.[sortKey] ?? (sortDir === "asc" ? Infinity : -Infinity));
    const sign = sortDir === "asc" ? 1 : -1;
    return [...symbols].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === "string") return sign * av.localeCompare(bv as string);
      return sign * ((av as number) - (bv as number));
    });
  }, [symbols, quotes, sortKey, sortDir]);
  sortedRef.current = sorted;

  const toggleSort = (k: SortKey) => { if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(k); setSortDir(k === "symbol" ? "asc" : "desc"); } };

  // keyboard navigation: Space/Down = next, Up = previous (in sorted order)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const list = sortedRef.current;
      if (list.length === 0) return;
      if (e.code === "Space" || e.key === "ArrowDown") {
        e.preventDefault();
        const i = list.indexOf(selRef.current);
        setSelected(list[(i + 1 + list.length) % list.length]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const i = list.indexOf(selRef.current);
        setSelected(list[(i - 1 + list.length) % list.length]);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // keep selected row visible
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-sym="${CSS.escape(selected)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const loadUniverse = useCallback((k: string) => setUniverse(k), []);
  const SortH = ({ k, children, align }: { k: SortKey; children: React.ReactNode; align?: "right" }) => {
    const Icon = sortKey !== k ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return <th onClick={() => toggleSort(k)} className={`px-2 py-1.5 cursor-pointer select-none hover:text-gray-900 ${align === "right" ? "text-right" : "text-left"}`}>
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>{children}<Icon size={10} className={sortKey === k ? "text-blue-600" : "text-gray-400"} /></span>
    </th>;
  };

  return (
    <div className="flex h-full min-h-0 -m-6">
      {/* chart */}
      <div className="flex-1 min-w-0 flex flex-col p-3 gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-lg font-semibold text-white">{selected ? short(selected) : "Charts"}</span>
          {quotes[selected] && <span className={`text-sm font-mono ${chgColor(quotes[selected].ch)}`}>{inr(quotes[selected].lp)} <span className="text-xs">({quotes[selected].chp > 0 ? "+" : ""}{quotes[selected].chp}%)</span></span>}
          <div className="flex items-center rounded-lg border border-gray-700 overflow-hidden text-xs ml-2">
            {TIMEFRAMES.map(([k, label]) => <button key={k} onClick={() => setTimeframe(k)} className={`px-2.5 py-1 ${timeframe === k ? "bg-brand-600 text-white" : "bg-gray-800 text-gray-300 hover:text-white"}`}>{label}</button>)}
          </div>
          <span className="text-[11px] text-gray-500 ml-auto">Space / ↓ next · ↑ previous</span>
        </div>
        {loadingChart && candles.length === 0
          ? <div className="flex-1 min-h-0 flex items-center justify-center bg-white rounded-lg text-gray-400 text-sm">Loading chart…</div>
          : <ChartsChart candles={candles} symbol={selected} timeframe={timeframe} livePrice={quotes[selected]?.lp} height={520} />}
      </div>

      {/* list */}
      <div className="w-72 shrink-0 border-l border-gray-800 bg-gray-900 flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-gray-800">
          <select value={universe} onChange={e => loadUniverse(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white font-medium">
            {universes.map(u => <option key={u.key} value={u.key}>{u.label}{u.count ? ` (${u.count})` : ""}</option>)}
          </select>
        </div>
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-400 sticky top-0 bg-gray-900 border-b border-gray-800">
              <tr><SortH k="symbol">Symbol</SortH><SortH k="lp" align="right">Last</SortH><SortH k="ch" align="right">Chg</SortH><SortH k="chp" align="right">Chg%</SortH></tr>
            </thead>
            <tbody>
              {sorted.length === 0 && <tr><td colSpan={4} className="text-center py-6 text-gray-500">Loading…</td></tr>}
              {sorted.map(s => {
                const q = quotes[s]; const sel = s === selected;
                return (
                  <tr key={s} data-sym={s} onClick={() => setSelected(s)} className={`cursor-pointer border-l-2 ${sel ? "bg-brand-600/15 border-brand-500" : "border-transparent hover:bg-gray-800/60"}`}>
                    <td className="px-2 py-1.5 font-medium text-gray-100">{short(s)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-200">{inr(q?.lp)}</td>
                    <td className={`px-2 py-1.5 text-right font-mono ${chgColor(q?.ch)}`}>{q?.ch != null ? (q.ch > 0 ? "+" : "") + inr(q.ch) : "—"}</td>
                    <td className={`px-2 py-1.5 text-right font-mono ${chgColor(q?.chp)}`}>{q?.chp != null ? (q.chp > 0 ? "+" : "") + q.chp + "%" : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-1.5 border-t border-gray-800 text-[10px] text-gray-500">live · 5s · click a column to sort</div>
      </div>
    </div>
  );
}
