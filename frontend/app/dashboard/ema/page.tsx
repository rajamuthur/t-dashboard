"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, Play, ChevronDown, ChevronRight, GitFork, TrendingUp, TrendingDown } from "lucide-react";
import {
  EmaRow, EmaResult, EmaStatus, EmaChart, Universe,
  runEmaScan, getEmaStatus, getEmaResult, getEmaUniverses, getEmaChart,
} from "@/lib/emaApi";
import PatternShapeChart from "@/components/PatternShapeChart";

type Filt = "all" | "bull" | "bear" | "coiling";

function pctColor(p: number | null | undefined) {
  if (p == null || p === 0) return "text-gray-400";
  return p > 0 ? "text-green-400" : "text-red-400";
}
function short(sym: string) { return sym.replace("NSE:", "").replace("-EQ", ""); }

export default function EmaPage() {
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [universe, setUniverse] = useState("nifty50");
  const [timeframe, setTimeframe] = useState("day");
  const [crossWindow, setCrossWindow] = useState(10);
  const [nearPct, setNearPct] = useState(2);
  const [nearBars, setNearBars] = useState(10);
  const [filt, setFilt] = useState<Filt>("all");

  const [result, setResult] = useState<EmaResult | null>(null);
  const [status, setStatus] = useState<EmaStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [chartCache, setChartCache] = useState<Record<string, EmaChart>>({});
  const [loadingChart, setLoadingChart] = useState<string | null>(null);
  const tfRef = useRef(timeframe);
  tfRef.current = timeframe;

  useEffect(() => {
    getEmaUniverses().then(setUniverses).catch(() => {});
    getEmaResult().then(r => { if (r?.rows?.length) setResult(r); }).catch(() => {});
  }, []);

  async function runScan() {
    if (running) return;
    setRunning(true); setMsg(null); setExpanded(null); setStatus({ status: "running", step: "Starting…" });
    try {
      await runEmaScan({ universe, timeframe, crossWindow, nearPct, nearBars });
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const s = await getEmaStatus(); setStatus(s);
        if (s.status === "completed") { setResult(await getEmaResult()); break; }
        if (s.status === "failed") { setMsg(s.message || "Scan failed"); break; }
      }
    } catch (e: any) {
      setMsg("Error: " + (e?.message || "failed").replace(/^API \d+:\s*/, ""));
    } finally { setRunning(false); }
  }

  async function toggleChart(sym: string) {
    if (expanded === sym) { setExpanded(null); return; }
    setExpanded(sym);
    if (chartCache[sym]) return;
    setLoadingChart(sym);
    try { const ch = await getEmaChart(sym, tfRef.current); setChartCache(p => ({ ...p, [sym]: ch })); } catch {} finally { setLoadingChart(null); }
  }

  const rows = (result?.rows ?? []).filter(r =>
    filt === "all" ? true : filt === "coiling" ? r.coiling : r.signal === filt.toUpperCase());
  const c = result?.counts ?? {};

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2"><GitFork size={20} className="text-brand-500" /> EMA 50 / 200 Cross Scanner</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          <b className="text-green-300">Bull</b>: EMA 50 crosses above EMA 200 &amp; price above EMA 200. <b className="text-red-300">Bear</b>: EMA 50 crosses below EMA 200 &amp; price below. <b className="text-amber-300">Coiling</b> = both EMAs &amp; price hugging tight for ~{nearBars} bars.
          {result?.at && <span className="text-gray-500"> · Last: {new Date(result.at).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</span>}
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm text-gray-400">Universe
          <select value={universe} onChange={e => setUniverse(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white">
            {universes.map(u => <option key={u.key} value={u.key}>{u.label}{u.count ? ` (${u.count})` : ""}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-400">TF
          <select value={timeframe} onChange={e => setTimeframe(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white">
            <option value="day">Daily</option><option value="week">Weekly</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-400">Cross within
          <input type="number" min={1} max={120} value={crossWindow} onChange={e => setCrossWindow(Math.max(1, Number(e.target.value) || 10))} className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white" />bars</label>
        <label className="flex items-center gap-1.5 text-sm text-gray-400">Near
          <input type="number" step="0.5" min={0.1} value={nearPct} onChange={e => setNearPct(Math.max(0.1, Number(e.target.value) || 2))} className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white" />%</label>
        <button onClick={runScan} disabled={running} className="flex items-center gap-2 px-4 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
          {running ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />} Scan
        </button>
      </div>

      {running && status?.step && (
        <div className="flex items-center gap-3 p-2.5 bg-brand-900/30 border border-brand-700/40 rounded-lg text-xs text-brand-200">
          <RefreshCw size={13} className="animate-spin" /><span>{status.current ? `Scanning ${status.current}` : status.step}</span>
          {status.total ? <span className="ml-auto text-gray-400">{status.done ?? 0}/{status.total}</span> : null}
        </div>
      )}
      {msg && <div className="text-xs px-3 py-2 rounded-lg bg-red-950/40 text-red-300">{msg}</div>}

      {/* Filter chips */}
      {result && (
        <div className="flex items-center gap-2 text-xs">
          {([["all", `All (${result.rows.length})`], ["bull", `Bull (${c.bull ?? 0})`], ["bear", `Bear (${c.bear ?? 0})`], ["coiling", `Coiling (${c.coiling ?? 0})`]] as [Filt, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setFilt(k)} className={`px-3 py-1 rounded-full border ${filt === k ? "bg-brand-600 border-brand-500 text-white" : "bg-gray-800 border-gray-700 text-gray-300 hover:text-white"}`}>{label}</button>
          ))}
          <span className="ml-auto text-gray-500">scanned {c.scanned ?? 0}</span>
        </div>
      )}

      {/* Results */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-gray-400 text-xs border-b border-gray-800">
            <tr>
              <th className="w-6 px-2 py-2" /><th className="px-3 py-2 text-left">Signal</th><th className="px-3 py-2 text-left">Stock</th>
              <th className="px-3 py-2 text-left">Cross</th><th className="px-3 py-2 text-right">Close</th>
              <th className="px-3 py-2 text-right">EMA 50</th><th className="px-3 py-2 text-right">EMA 200</th>
              <th className="px-3 py-2 text-right">Gap</th><th className="px-3 py-2 text-right">Px vs 200</th><th className="px-3 py-2 text-center">Coiling</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} className="text-center py-10 text-gray-500">{result ? "No matches for this filter." : "Run a scan to find EMA 50/200 crossovers."}</td></tr>}
            {rows.map(r => {
              const open = expanded === r.symbol;
              const bull = r.signal === "BULL";
              const ch = chartCache[r.symbol];
              return [
                <tr key={r.symbol} onClick={() => toggleChart(r.symbol)} className="border-b border-gray-800/60 hover:bg-gray-800/40 cursor-pointer">
                  <td className="px-2 py-2 text-gray-500">{loadingChart === r.symbol ? <RefreshCw size={12} className="animate-spin" /> : open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</td>
                  <td className="px-3 py-2"><span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded ${bull ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300"}`}>{bull ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{r.signal}</span></td>
                  <td className="px-3 py-2 font-medium text-white">{short(r.symbol)}</td>
                  <td className="px-3 py-2 text-gray-400">{r.days_since === 0 ? "today" : `${r.days_since}d ago`}<span className="text-gray-600 text-[10px]"> · {r.cross_date}</span></td>
                  <td className="px-3 py-2 text-right font-mono text-gray-200">{r.close}</td>
                  <td className="px-3 py-2 text-right font-mono text-amber-300">{r.ema50}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-300">{r.ema200}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-300">{r.gap_pct}%</td>
                  <td className={`px-3 py-2 text-right font-mono ${pctColor(r.price_vs_ema200_pct)}`}>{r.price_vs_ema200_pct > 0 ? "+" : ""}{r.price_vs_ema200_pct}%</td>
                  <td className="px-3 py-2 text-center">{r.coiling ? <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300" title={`Tight for ${r.coiled_bars} bars`}>coiling</span> : <span className="text-gray-700">—</span>}</td>
                </tr>,
                open && (
                  <tr key={`${r.symbol}-c`} className="bg-gray-950 border-b border-gray-800">
                    <td colSpan={10} className="px-4 py-3">
                      {ch ? <PatternShapeChart candles={ch.candles} shapes={ch.shapes} height={340} focusDate={ch.focus_date ?? undefined} />
                        : <div className="text-gray-500 text-sm py-6 text-center">Loading chart…</div>}
                    </td>
                  </tr>
                ),
              ].filter(Boolean);
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
