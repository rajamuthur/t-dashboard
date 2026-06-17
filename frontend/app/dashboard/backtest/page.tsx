"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Play, RefreshCw, FlaskConical } from "lucide-react";
import {
  StrategyInfo, Universe, BacktestRun, BacktestResult, BacktestStats,
  getStrategies, getBacktestUniverses, runBacktest, getBacktestStatus, getBacktestRuns, getBacktestRun,
} from "@/lib/backtestApi";

const POLL_MS = 2500;
function cleanSym(s: string) { return s.replace("NSE:", "").replace("-EQ", "").replace("-INDEX", ""); }
function pnlColor(v: number | null | undefined) {
  if (v == null || v === 0) return "text-gray-300";
  return v > 0 ? "text-green-400" : "text-red-400";
}

function Stat({ label, value, tone, sub }: { label: string; value: string | number; tone?: "pos" | "neg" | "neutral"; sub?: string }) {
  const color = tone === "pos" ? "text-green-400" : tone === "neg" ? "text-red-400" : "text-gray-100";
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-xl font-semibold font-mono tabular-nums mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function EquityCurve({ points }: { points: { date: string; cum_pct: number }[] }) {
  if (points.length < 2) return <div className="text-gray-500 text-sm py-10 text-center">No trades to chart.</div>;
  const W = 760, H = 200, pad = 8;
  const ys = points.map(p => p.cum_pct);
  const min = Math.min(0, ...ys), max = Math.max(0, ...ys);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.cum_pct).toFixed(1)}`).join(" ");
  const last = ys[ys.length - 1];
  const zeroY = y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke="#334155" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke={last >= 0 ? "#22c55e" : "#ef4444"} strokeWidth={1.5} />
    </svg>
  );
}

export default function BacktestPage() {
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [strategy, setStrategy] = useState("orb");
  const [universe, setUniverse] = useState("fo");
  const [costPct, setCostPct] = useState(0.10);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"symbols" | "trades">("symbols");

  useEffect(() => { getStrategies().then(setStrategies).catch(() => {}); getBacktestUniverses().then(setUniverses).catch(() => {}); }, []);

  const loadRuns = useCallback(async () => {
    const r = await getBacktestRuns().catch(() => []);
    setRuns(r);
    if (r.length && selected == null) setSelected(r[0].id);
  }, [selected]);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  useEffect(() => {
    if (selected == null) { setResult(null); return; }
    getBacktestRun(selected).then(r => setResult(r.result ?? null)).catch(() => setResult(null));
  }, [selected]);

  async function run() {
    setRunning(true); setMsg(null); setStatus("Starting…");
    try {
      await runBacktest({ strategy, universe, cost_pct: costPct, from_date: fromDate || undefined, to_date: toDate || undefined });
      for (let i = 0; i < 200; i++) {
        await new Promise(r => setTimeout(r, POLL_MS));
        const s = await getBacktestStatus();
        setStatus(s.step || s.status || "");
        if (s.status === "completed") { await loadRuns(); if (s.run_id) setSelected(s.run_id); break; }
        if (s.status === "failed") { setMsg("Failed: " + (s.message || "")); break; }
      }
    } catch (e: any) {
      setMsg("Error: " + (e?.message || "run failed").replace(/^API \d+:\s*/, ""));
    } finally { setRunning(false); setStatus(""); }
  }

  const o = result?.overall;
  const profitable = (o?.expectancy ?? 0) > 0;
  const runLabel = (r: BacktestRun) =>
    `${strategies.find(s => s.key === r.strategy)?.label ?? r.strategy} · ${r.universe} · ${(r.overall?.net_pct ?? 0).toFixed(0)}% · ${new Date(r.created_at).toLocaleString()}`;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><FlaskConical size={20} className="text-brand-500" /> Strategy Backtest</h1>
          <p className="text-sm text-gray-400 mt-0.5">5-minute intraday strategies — net of costs, squared off by 15:15. Backtests on price (equity / futures / index signal).</p>
        </div>
        <button onClick={run} disabled={running}
          className="flex items-center gap-2 px-5 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
          {running ? <><RefreshCw size={15} className="animate-spin" /> Running…</> : <><Play size={15} /> Run Backtest</>}
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={strategy} onChange={e => setStrategy(e.target.value)} title="Strategy"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white">
          {strategies.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={universe} onChange={e => setUniverse(e.target.value)} title="Universe"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white">
          {(universes.length ? universes : [{ key: "fo", label: "F&O", count: 0 }]).map(u => (
            <option key={u.key} value={u.key}>{u.label}{u.count ? ` (${u.count})` : ""}</option>
          ))}
        </select>
        <label className="text-xs text-gray-400 flex items-center gap-1">Cost %
          <input type="number" step="0.01" min="0" value={costPct} onChange={e => setCostPct(Number(e.target.value))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white w-20" />
        </label>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} title="From"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white" />
        <span className="text-gray-500 text-sm">to</span>
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} title="To"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white" />
        {running && status && <span className="text-xs text-gray-500">{status}</span>}
      </div>

      {strategies.find(s => s.key === strategy) && (
        <p className="text-xs text-gray-500">{strategies.find(s => s.key === strategy)!.description}</p>
      )}
      {msg && <div className={`text-xs px-3 py-2 rounded-lg ${msg.startsWith("Error") || msg.startsWith("Failed") ? "bg-red-950/40 text-red-300" : "bg-green-950/40 text-green-300"}`}>{msg}</div>}

      {/* Saved runs */}
      {runs.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Run:</span>
          <select value={selected ?? ""} onChange={e => setSelected(e.target.value ? Number(e.target.value) : null)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white max-w-xl">
            {runs.map(r => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
          </select>
        </div>
      )}

      {/* Overall stats */}
      {o && (
        <>
          <div className={`text-xs px-3 py-2 rounded-lg ${profitable ? "bg-green-950/40 text-green-300" : "bg-red-950/40 text-red-300"}`}>
            {profitable
              ? `Net positive: +${o.expectancy}% per trade after costs.`
              : `Not profitable after costs: ${o.expectancy}% per trade. Tune thresholds / lower cost (futures) / try another universe before paper-trading.`}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Stat label="Trades" value={o.trades} />
            <Stat label="Win rate" value={`${o.win_rate}%`} tone={o.win_rate >= 50 ? "pos" : "neutral"} />
            <Stat label="Expectancy" value={`${o.expectancy}%`} tone={o.expectancy > 0 ? "pos" : "neg"} sub="per trade, net" />
            <Stat label="Net P&L" value={`${o.net_pct}%`} tone={o.net_pct > 0 ? "pos" : "neg"} sub="sum of trade %" />
            <Stat label="Max DD" value={`${o.max_dd}%`} tone="neg" />
            <Stat label="Avg win / loss" value={`${o.avg_win} / ${o.avg_loss}`} />
          </div>
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Equity curve (cumulative net %)</div>
            <EquityCurve points={result!.equity_curve} />
          </div>
        </>
      )}

      {/* Tabs: per-symbol + trades */}
      {result && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="flex gap-1 border-b border-gray-800 px-3 pt-2">
            {(["symbols", "trades"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-sm rounded-t-lg ${tab === t ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white"}`}>
                {t === "symbols" ? `By symbol (${result.per_symbol.length})` : `Trades (${result.trades.length})`}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            {tab === "symbols" ? (
              <table className="w-full text-sm">
                <thead className="text-gray-400 text-xs border-b border-gray-800 sticky top-0 bg-gray-900">
                  <tr><th className="px-3 py-2 text-left">Symbol</th><th className="px-3 py-2 text-right">Trades</th><th className="px-3 py-2 text-right">Win%</th><th className="px-3 py-2 text-right">Exp%</th><th className="px-3 py-2 text-right">Net%</th><th className="px-3 py-2 text-right">Max DD</th></tr>
                </thead>
                <tbody>
                  {result.per_symbol.map(s => (
                    <tr key={s.symbol} className="border-b border-gray-800/60">
                      <td className="px-3 py-1.5 font-medium text-white">{cleanSym(s.symbol)}</td>
                      <td className="px-3 py-1.5 text-right text-gray-300">{s.trades}</td>
                      <td className="px-3 py-1.5 text-right text-gray-300">{s.win_rate}%</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${pnlColor(s.expectancy)}`}>{s.expectancy}%</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${pnlColor(s.net_pct)}`}>{s.net_pct}%</td>
                      <td className="px-3 py-1.5 text-right font-mono text-red-400">{s.max_dd}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-gray-400 text-xs border-b border-gray-800 sticky top-0 bg-gray-900">
                  <tr><th className="px-3 py-2 text-left">Symbol</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Side</th><th className="px-3 py-2 text-right">Entry</th><th className="px-3 py-2 text-right">Exit</th><th className="px-3 py-2 text-left">Out</th><th className="px-3 py-2 text-right">P&L%</th><th className="px-3 py-2 text-left">In→Out</th></tr>
                </thead>
                <tbody>
                  {result.trades.slice().reverse().map((t, i) => (
                    <tr key={i} className="border-b border-gray-800/60">
                      <td className="px-3 py-1.5 font-medium text-white">{cleanSym(t.symbol)}</td>
                      <td className="px-3 py-1.5 text-gray-400">{t.date}</td>
                      <td className="px-3 py-1.5"><span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${t.side === "long" ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"}`}>{t.side}</span></td>
                      <td className="px-3 py-1.5 text-right font-mono text-gray-300">{t.entry}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-gray-300">{t.exit}</td>
                      <td className="px-3 py-1.5 text-gray-400 text-xs">{t.outcome}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${pnlColor(t.pnl_pct)}`}>{t.pnl_pct}%</td>
                      <td className="px-3 py-1.5 text-gray-500 text-xs">{t.entry_time}→{t.exit_time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {!result && !running && (
        <div className="text-center py-12 text-gray-500 text-sm">Pick a strategy + universe and click <span className="text-white">Run Backtest</span>.</div>
      )}
    </div>
  );
}
