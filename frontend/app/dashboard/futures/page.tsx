"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, Play, ChevronDown, ChevronRight, Radio, AlertTriangle } from "lucide-react";
import {
  FutResult, FutStatus, FutMatch, FutChart, FutContract,
  runFuturesScan, getFuturesStatus, getFuturesResult, getFuturesHistory, getFuturesChart,
} from "@/lib/futuresApi";
import PatternShapeChart from "@/components/PatternShapeChart";

const AUTO_MS = 5 * 60 * 1000;
const premColor = (p: number | null) => (p == null ? "text-gray-600" : p > 0 ? "text-green-400" : p < 0 ? "text-red-400" : "text-gray-300");

function FlagBadge({ c }: { c: FutContract }) {
  if (!c.vs_spot && !c.curve) return null;
  const buy = c.action === "BUY";
  const label = [c.vs_spot, c.curve && `OFF-${c.curve}`].filter(Boolean).join(" ");
  return <span className={`ml-1 text-[9px] uppercase px-1 py-0.5 rounded ${buy ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300"}`} title={`${label} → ${c.action}`}>{c.action}</span>;
}

function Cell({ c }: { c: FutContract | undefined }) {
  if (!c) return <td className="px-3 py-2 text-right text-gray-700">—</td>;
  return (
    <td className={`px-3 py-2 text-right ${c.focus ? "" : "opacity-50"}`}>
      <span className="font-mono text-gray-200">{c.price ?? "—"}</span>
      {c.premium != null && <span className={`ml-1 font-mono text-xs ${premColor(c.premium)}`}>{c.premium > 0 ? "+" : ""}{c.premium}%</span>}
      <FlagBadge c={c} />
    </td>
  );
}

export default function FuturesPage() {
  const [threshold, setThreshold] = useState(5);
  const [curveTol, setCurveTol] = useState(1.5);
  const [auto, setAuto] = useState(true);
  const [flaggedOnly, setFlaggedOnly] = useState(true);

  const [result, setResult] = useState<FutResult | null>(null);
  const [status, setStatus] = useState<FutStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<FutMatch[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [chartCache, setChartCache] = useState<Record<string, FutChart>>({});
  const [loadingChart, setLoadingChart] = useState<string | null>(null);

  const runRef = useRef<() => void>(() => {});

  async function runScan() {
    if (running) return;
    setRunning(true); setMsg(null); setStatus({ status: "running", step: "Starting…" });
    try {
      await runFuturesScan(threshold, curveTol, true);
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const s = await getFuturesStatus(); setStatus(s);
        if (s.status === "completed") { setResult(await getFuturesResult()); getFuturesHistory().then(setHistory).catch(() => {}); break; }
        if (s.status === "failed") { setMsg(s.message || "Scan failed" + (s.token === false ? " — re-login in Settings → Broker" : "")); break; }
      }
    } catch (e: any) {
      setMsg("Error: " + (e?.message || "failed").replace(/^API \d+:\s*/, ""));
    } finally { setRunning(false); setNextAt(Date.now() + AUTO_MS); }
  }
  runRef.current = runScan;

  // Initial load: last result + history
  useEffect(() => {
    getFuturesResult().then(r => { if (r?.rows?.length) setResult(r); }).catch(() => {});
    getFuturesHistory().then(setHistory).catch(() => {});
  }, []);

  // 1s tick for the countdown
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Page-scoped 5-min auto-refresh — starts on enable, stops on unmount/toggle-off
  useEffect(() => {
    if (!auto) { setNextAt(null); return; }
    runRef.current();
    const iv = setInterval(() => runRef.current(), AUTO_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  async function toggleChart(sym: string) {
    if (expanded === sym) { setExpanded(null); return; }
    setExpanded(sym);
    if (chartCache[sym]) return;
    setLoadingChart(sym);
    try { const ch = await getFuturesChart(sym); setChartCache(p => ({ ...p, [sym]: ch })); } catch {} finally { setLoadingChart(null); }
  }

  const rows = (result?.rows ?? []).filter(r => !flaggedOnly || r.flagged);
  const countdown = auto && nextAt ? Math.max(0, Math.floor((nextAt - now) / 1000)) : null;
  const mmss = countdown != null ? `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, "0")}` : null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><Radio size={20} className="text-brand-500" /> Futures Basis Scanner</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Next-3 monthly futures vs spot for all F&O + NIFTY/BANKNIFTY. Flags <b className="text-red-300">RICH</b>/<b className="text-green-300">CHEAP</b> vs spot and <b>OFF-CURVE</b> months (odd one out) → buy/short the mispricing.
            {result?.at && <span className="text-gray-500"> · Last: {new Date(result.at).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</span>}
          </p>
        </div>
        {auto && <div className="text-right text-xs text-gray-400 shrink-0">{running ? <span className="text-brand-300">scanning…</span> : mmss ? <>next in <b className="text-white font-mono">{mmss}</b></> : null}</div>}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-400">Threshold
          <input type="number" step="0.5" min={0.1} value={threshold} onChange={e => setThreshold(Math.max(0.1, Number(e.target.value) || 5))}
            className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white" />%</label>
        <label className="flex items-center gap-2 text-sm text-gray-400">Curve tol
          <input type="number" step="0.5" min={0.1} value={curveTol} onChange={e => setCurveTol(Math.max(0.1, Number(e.target.value) || 1.5))}
            className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white" />%</label>
        <button onClick={() => setAuto(a => !a)}
          className={`px-3 py-1.5 rounded-lg text-sm border ${auto ? "bg-green-600/20 border-green-600/50 text-green-300" : "bg-gray-800 border-gray-700 text-gray-300"}`}>
          Auto-refresh {auto ? "ON (5m)" : "OFF"}
        </button>
        <button onClick={runScan} disabled={running}
          className="flex items-center gap-2 px-4 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
          {running ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />} Re-run
        </button>
        <label className="flex items-center gap-1.5 text-sm text-gray-400 ml-auto">
          <input type="checkbox" className="accent-brand-500" checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)} /> flagged only
        </label>
      </div>

      {running && status?.step && (
        <div className="flex items-center gap-3 p-2.5 bg-brand-900/30 border border-brand-700/40 rounded-lg text-xs text-brand-200">
          <RefreshCw size={13} className="animate-spin" /><span>{status.current ? `Scanning ${status.current}` : status.step}</span>
          {status.total ? <span className="ml-auto text-gray-400">{status.done ?? 0}/{status.total}</span> : null}
        </div>
      )}
      {msg && <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-red-950/40 text-red-300"><AlertTriangle size={13} /> {msg}</div>}

      {/* Results */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-gray-400 text-xs border-b border-gray-800">
            <tr><th className="w-6 px-2 py-2" /><th className="px-3 py-2 text-left">Underlying</th><th className="px-3 py-2 text-right">Spot</th><th className="px-3 py-2 text-right">Month 1</th><th className="px-3 py-2 text-right">Month 2</th><th className="px-3 py-2 text-right">Month 3</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-gray-500">{result ? "No flagged contracts. Uncheck 'flagged only' to see all, or lower the threshold." : "Run a scan (needs a live Fyers token)."}</td></tr>}
            {rows.map(r => {
              const isOpen = expanded === r.underlying;
              const ch = chartCache[r.underlying];
              return [
                <tr key={r.underlying} onClick={() => toggleChart(r.underlying)} className={`border-b border-gray-800/60 hover:bg-gray-800/40 cursor-pointer ${r.flagged ? "" : "opacity-80"}`}>
                  <td className="px-2 py-2 text-gray-500">{loadingChart === r.underlying ? <RefreshCw size={12} className="animate-spin" /> : isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</td>
                  <td className="px-3 py-2 font-medium text-white">{r.underlying}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-300">{r.spot}</td>
                  <Cell c={r.contracts[0]} /><Cell c={r.contracts[1]} /><Cell c={r.contracts[2]} />
                </tr>,
                isOpen && (
                  <tr key={`${r.underlying}-c`} className="bg-gray-950 border-b border-gray-800">
                    <td colSpan={6} className="px-4 py-3">
                      {ch ? <PatternShapeChart candles={ch.candles} shapes={ch.shapes} height={320} focusDate={ch.focus_date ?? undefined} />
                        : <div className="text-gray-500 text-sm py-6 text-center">Loading chart…</div>}
                    </td>
                  </tr>
                ),
              ].filter(Boolean);
            })}
          </tbody>
        </table>
      </div>

      {/* Match history */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-x-auto">
        <div className="px-4 py-2 text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">Match log (past alerts — validate over time)</div>
        <table className="w-full text-sm">
          <thead className="text-gray-400 text-xs border-b border-gray-800">
            <tr><th className="px-3 py-2 text-left">Time</th><th className="px-3 py-2 text-left">Underlying</th><th className="px-3 py-2 text-left">Month</th><th className="px-3 py-2 text-center">Action</th><th className="px-3 py-2 text-left">Signal</th><th className="px-3 py-2 text-right">Spot</th><th className="px-3 py-2 text-right">Future</th><th className="px-3 py-2 text-right">Prem%</th></tr>
          </thead>
          <tbody>
            {history.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-gray-500">No matches logged yet.</td></tr>}
            {history.map(m => (
              <tr key={m.id} className="border-b border-gray-800/60">
                <td className="px-3 py-2 text-gray-400">{new Date(m.ts).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</td>
                <td className="px-3 py-2 font-medium text-white">{m.underlying}</td>
                <td className="px-3 py-2 text-gray-300">{m.month}</td>
                <td className="px-3 py-2 text-center"><span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${m.action === "BUY" ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300"}`}>{m.action}</span></td>
                <td className="px-3 py-2 text-gray-400 text-xs">{m.kind}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-300">{m.spot}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-300">{m.future}</td>
                <td className={`px-3 py-2 text-right font-mono ${premColor(m.premium)}`}>{m.premium > 0 ? "+" : ""}{m.premium}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
