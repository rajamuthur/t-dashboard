"use client";
import { useState } from "react";
import { Play, RefreshCw, TrendingUp, Activity } from "lucide-react";
import {
  SwingTf, SwingResult, SwingSignal,
  runSwingBacktest, getSwingStatus, getSwingRun, getSwingCurrent,
} from "@/lib/swingApi";

const TFS: { v: SwingTf; label: string }[] = [
  { v: "day", label: "Daily" }, { v: "week", label: "Weekly" }, { v: "month", label: "Monthly" },
];
const POLL_MS = 2500;
const clean = (s: string) => s.replace("NSE:", "").replace("-EQ", "");
const pnlColor = (p: number) => (p > 0 ? "text-green-400" : p < 0 ? "text-red-400" : "text-gray-300");

function StatCard({ label, value, tone = "neutral", sub }: { label: string; value: string | number; tone?: "pos" | "neg" | "neutral"; sub?: string }) {
  const c = tone === "pos" ? "text-green-400" : tone === "neg" ? "text-red-400" : "text-gray-100";
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-xl font-semibold font-mono tabular-nums mt-1 ${c}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function EquityCurve({ pts }: { pts: { date: string; cum_pct: number }[] }) {
  if (pts.length < 2) return null;
  const W = 680, H = 120, vals = pts.map(p => p.cum_pct);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals), span = max - min || 1;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / span) * H;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.cum_pct).toFixed(1)}`).join(" ");
  const last = vals[vals.length - 1];
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Equity curve (cumulative %)</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 120 }} preserveAspectRatio="none">
        <line x1="0" y1={y(0)} x2={W} y2={y(0)} stroke="#374151" strokeWidth="1" strokeDasharray="4 4" />
        <path d={d} fill="none" stroke={last >= 0 ? "#22c55e" : "#ef4444"} strokeWidth="1.5" />
      </svg>
    </div>
  );
}

export default function SwingPage() {
  const [tab, setTab] = useState<"backtest" | "current">("backtest");
  const [timeframe, setTimeframe] = useState<SwingTf>("day");
  const [lookback, setLookback] = useState(22);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<SwingResult | null>(null);

  const [current, setCurrent] = useState<SwingSignal[] | null>(null);
  const [loadingCur, setLoadingCur] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function runBacktest() {
    setRunning(true); setMsg(null); setStatus("Starting…"); setResult(null);
    try {
      await runSwingBacktest(timeframe, lookback);
      for (let i = 0; i < 200; i++) {
        await new Promise(r => setTimeout(r, POLL_MS));
        const s = await getSwingStatus();
        setStatus(s.step || s.status || "");
        if (s.status === "completed" && s.run_id) { const r = await getSwingRun(s.run_id); setResult(r.result); break; }
        if (s.status === "failed") { setMsg("Backtest failed: " + (s.message || "")); break; }
      }
    } catch (e: any) {
      setMsg("Error: " + (e?.message || "failed").replace(/^API \d+:\s*/, ""));
    } finally { setRunning(false); setStatus(""); }
  }

  async function findCurrent() {
    setLoadingCur(true); setMsg(null);
    try { setCurrent(await getSwingCurrent(timeframe, lookback)); }
    catch (e: any) { setMsg("Error: " + (e?.message || "failed").replace(/^API \d+:\s*/, "")); }
    finally { setLoadingCur(false); }
  }

  const o = result?.overall;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2"><TrendingUp size={20} className="text-brand-500" /> Swing Trading</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Donchian channel breakout — long-only. Enter on a {lookback}-bar high breakout, exit on a {lookback}-bar low.
          NIFTY 500 universe (≈ market cap &gt; ₹5000cr).
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        {(["backtest", "current"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm capitalize ${tab === t ? "bg-brand-600 text-white" : "text-gray-400 hover:text-white"}`}>
            {t === "backtest" ? "Backtest" : "Current entries"}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {TFS.map(tf => (
            <button key={tf.v} onClick={() => setTimeframe(tf.v)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${timeframe === tf.v ? "bg-brand-600 border-brand-500 text-white" : "bg-gray-800 border-gray-700 text-gray-300 hover:text-white"}`}>
              {tf.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-400">
          Lookback
          <input type="number" min={2} max={200} value={lookback}
            onChange={e => setLookback(Math.max(2, Math.min(200, Number(e.target.value) || 22)))}
            className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white" />
          <span className="text-gray-600">bars</span>
        </label>
        {tab === "backtest" ? (
          <button onClick={runBacktest} disabled={running}
            className="flex items-center gap-2 px-5 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
            {running ? <><RefreshCw size={15} className="animate-spin" /> Backtesting…</> : <><Play size={15} /> Run Backtest</>}
          </button>
        ) : (
          <button onClick={findCurrent} disabled={loadingCur}
            className="flex items-center gap-2 px-5 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
            {loadingCur ? <><RefreshCw size={15} className="animate-spin" /> Scanning…</> : <><Activity size={15} /> Find entries</>}
          </button>
        )}
        <span className="ml-auto text-xs text-gray-500">{running && status ? status : ""}</span>
      </div>

      {msg && <div className={`text-xs px-3 py-2 rounded-lg ${msg.startsWith("Error") ? "bg-red-950/40 text-red-300" : "bg-green-950/40 text-green-300"}`}>{msg}</div>}

      {/* BACKTEST TAB */}
      {tab === "backtest" && o && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <StatCard label="Trades" value={o.trades} sub={`${o.open} open`} />
            <StatCard label="Win rate" value={`${o.win_rate}%`} tone={o.win_rate >= 50 ? "pos" : "neg"} />
            <StatCard label="Expectancy" value={`${o.expectancy}%`} tone={o.expectancy > 0 ? "pos" : "neg"} sub="per trade" />
            <StatCard label="Net" value={`${o.net_pct}%`} tone={o.net_pct > 0 ? "pos" : "neg"} sub="sum of trade %" />
            <StatCard label="Max DD" value={`${o.max_dd}%`} tone="neg" />
            <StatCard label="Avg hold" value={`${o.avg_bars}`} sub="bars" />
          </div>

          {result!.equity_curve.length > 1 && <EquityCurve pts={result!.equity_curve} />}

          {/* Top symbols */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-x-auto">
            <div className="px-4 py-2 text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">Top symbols by net %</div>
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-xs border-b border-gray-800">
                <tr><th className="px-3 py-2 text-left">Symbol</th><th className="px-3 py-2 text-right">Trades</th><th className="px-3 py-2 text-right">Win%</th><th className="px-3 py-2 text-right">Net%</th><th className="px-3 py-2 text-right">Exp%</th><th className="px-3 py-2 text-right">Avg hold</th></tr>
              </thead>
              <tbody>
                {result!.per_symbol.slice(0, 25).map(s => (
                  <tr key={s.symbol} className="border-b border-gray-800/60">
                    <td className="px-3 py-2 font-medium text-white">{clean(s.symbol)}</td>
                    <td className="px-3 py-2 text-right text-gray-300">{s.trades}</td>
                    <td className="px-3 py-2 text-right text-gray-300">{s.win_rate}%</td>
                    <td className={`px-3 py-2 text-right font-mono ${pnlColor(s.net_pct)}`}>{s.net_pct}%</td>
                    <td className={`px-3 py-2 text-right font-mono ${pnlColor(s.expectancy)}`}>{s.expectancy}%</td>
                    <td className="px-3 py-2 text-right text-gray-400">{s.avg_bars}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Trades */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-x-auto">
            <div className="px-4 py-2 text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">Recent trades ({result!.trades.length} shown)</div>
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-xs border-b border-gray-800">
                <tr><th className="px-3 py-2 text-left">Symbol</th><th className="px-3 py-2 text-left">Entered</th><th className="px-3 py-2 text-right">Entry</th><th className="px-3 py-2 text-left">Exited</th><th className="px-3 py-2 text-right">Exit</th><th className="px-3 py-2 text-right">P&L %</th><th className="px-3 py-2 text-right">Bars</th><th className="px-3 py-2 text-center">Outcome</th></tr>
              </thead>
              <tbody>
                {result!.trades.slice(0, 200).map((t, i) => (
                  <tr key={i} className="border-b border-gray-800/60">
                    <td className="px-3 py-2 font-medium text-white">{clean(t.symbol || "")}</td>
                    <td className="px-3 py-2 text-gray-400">{t.entry_date}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-200">{t.entry}</td>
                    <td className="px-3 py-2 text-gray-400">{t.exit_date}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-200">{t.exit}</td>
                    <td className={`px-3 py-2 text-right font-mono ${pnlColor(t.pnl_pct)}`}>{t.pnl_pct}%</td>
                    <td className="px-3 py-2 text-right text-gray-400">{t.bars_held}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${t.outcome === "win" ? "bg-green-500/15 text-green-300" : t.outcome === "loss" ? "bg-red-500/15 text-red-300" : "bg-gray-600/30 text-gray-300"}`}>{t.outcome}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === "backtest" && !o && !running && (
        <div className="text-center py-12 text-gray-500">Pick a timeframe + lookback and click <span className="text-white">Run Backtest</span>.</div>
      )}

      {/* CURRENT TAB */}
      {tab === "current" && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-gray-400 text-xs border-b border-gray-800">
              <tr><th className="px-3 py-2 text-left">Symbol</th><th className="px-3 py-2 text-right">Entry (close)</th><th className="px-3 py-2 text-right">Breakout level</th><th className="px-3 py-2 text-right">Stop (lower band)</th><th className="px-3 py-2 text-left">Date</th></tr>
            </thead>
            <tbody>
              {loadingCur && <tr><td colSpan={5} className="text-center py-10 text-gray-500">Scanning…</td></tr>}
              {!loadingCur && current && current.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-gray-500">No fresh breakout entries on the latest {timeframe} bar.</td></tr>}
              {!loadingCur && current == null && <tr><td colSpan={5} className="text-center py-10 text-gray-500">Click <span className="text-white">Find entries</span> to scan for fresh breakouts.</td></tr>}
              {!loadingCur && (current ?? []).map(s => (
                <tr key={s.symbol} className="border-b border-gray-800/60">
                  <td className="px-3 py-2 font-medium text-white">{clean(s.symbol)}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-300">{s.entry}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-300">{s.upper}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-300">{s.stop}</td>
                  <td className="px-3 py-2 text-gray-400">{s.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {current && current.length > 0 && <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-800">{current.length} fresh entr{current.length === 1 ? "y" : "ies"} on the latest {timeframe} bar.</div>}
        </div>
      )}
    </div>
  );
}
