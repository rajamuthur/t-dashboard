"use client";
import { useEffect, useRef, useState } from "react";
import { Play, RefreshCw, ChevronDown, ChevronRight, TrendingUp, TrendingDown, Save, Send } from "lucide-react";
import GapReversalChart from "@/components/GapReversalChart";
import {
  GrConfig, Universe, GrBacktest, GrChart, GrWatch,
  getGrConfig, setGrConfig, getGrUniverses,
  runGrBacktest, getGrBacktestResult, getGrChart,
  getGrWatch, updateGrWatch, sendGrWatchEod, checkGrGaps,
} from "@/lib/gapReversalApi";

const num = (v: string, min = 0) => Math.max(min, Number(v) || 0);
const inr = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
function rColor(n: number) { return n > 0 ? "text-green-400" : n < 0 ? "text-red-400" : "text-gray-300"; }

const inp = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-[11px] text-gray-400 mb-1">{label}</label>{children}</div>;
}

export default function GapReversalPage() {
  const [cfg, setCfg] = useState<GrConfig | null>(null);
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [tab, setTab] = useState<"watch" | "backtest">("watch");
  const [showSettings, setShowSettings] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [bt, setBt] = useState<GrBacktest | null>(null);
  const [btRunning, setBtRunning] = useState(false);
  const [dir, setDir] = useState<"ALL" | "BULL" | "BEAR">("ALL");

  const [expanded, setExpanded] = useState<string | null>(null);
  const [chartCache, setChartCache] = useState<Record<string, GrChart>>({});
  const [loadingChart, setLoadingChart] = useState<string | null>(null);

  const [watch, setWatch] = useState<GrWatch | null>(null);
  const [watchUpdating, setWatchUpdating] = useState(false);
  const [watchSending, setWatchSending] = useState(false);

  useEffect(() => {
    getGrConfig().then(setCfg).catch(() => setMsg("Failed to load settings"));
    getGrUniverses().then(setUniverses).catch(() => {});
    getGrBacktestResult().then(r => { if (r?.total_signals) setBt(r); }).catch(() => {});
    getGrWatch().then(w => { if (w?.rows) setWatch(w); }).catch(() => {});
  }, []);

  // Auto-refresh the watchlist quotes every 30s while the tab is open.
  useEffect(() => {
    if (tab !== "watch") return;
    const load = () => getGrWatch().then(w => { if (w?.rows) setWatch(w); }).catch(() => {});
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, [tab]);

  function set<K extends keyof GrConfig>(k: K, v: GrConfig[K]) { setCfg(c => c ? { ...c, [k]: v } : c); }

  async function save(): Promise<boolean> {
    if (!cfg) return false;
    setSaving(true); setMsg(null);
    try { const s = await setGrConfig(cfg); setCfg(s); setMsg("Settings saved"); setTimeout(() => setMsg(null), 1800); return true; }
    catch (e: any) { setMsg((e?.message || "Save failed").replace(/^API \d+:\s*/, "")); return false; }
    finally { setSaving(false); }
  }

  async function doBacktest() {
    if (!(await save())) return;
    setBtRunning(true); setMsg(null);
    try { setBt(await runGrBacktest()); } catch (e: any) { setMsg((e?.message || "Backtest failed").replace(/^API \d+:\s*/, "")); }
    finally { setBtRunning(false); }
  }

  async function doWatchUpdate() {
    setWatchUpdating(true); setMsg(null);
    try { setWatch(await updateGrWatch()); setMsg("Watchlist refreshed"); setTimeout(() => setMsg(null), 2000); }
    catch (e: any) { setMsg((e?.message || "Update failed").replace(/^API \d+:\s*/, "")); }
    finally { setWatchUpdating(false); }
  }
  async function doWatchSend() {
    setWatchSending(true); setMsg(null);
    try { const r = await sendGrWatchEod(); setMsg(r.skipped ? `Skipped: ${r.skipped}` : `Sent ${r.count} stock(s) to Telegram`); getGrWatch().then(w => { if (w?.rows) setWatch(w); }).catch(() => {}); }
    catch (e: any) { setMsg((e?.message || "Send failed").replace(/^API \d+:\s*/, "")); }
    finally { setWatchSending(false); }
  }

  async function toggleChart(sym: string) {
    if (expanded === sym) { setExpanded(null); return; }
    setExpanded(sym);
    if (chartCache[sym]) return;
    setLoadingChart(sym);
    try { const ch = await getGrChart(sym); setChartCache(p => ({ ...p, [sym]: ch })); } catch {} finally { setLoadingChart(null); }
  }

  if (!cfg) return <div className="text-gray-500 text-sm">Loading…</div>;

  const exits = [...cfg.rr_targets.map(String), "ema"];
  const exitLabel = (e: string) => e === "ema" ? "EMA exit" : `1:${e}`;
  const btStats = bt ? (dir === "ALL" ? bt.by_exit : bt.by_direction[dir]) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><TrendingUp size={20} className="text-brand-500" /> Gap Reversal</h1>
          <p className="text-xs text-gray-500">RSI-on-EMA extreme + breakaway gap · configurable, multi R:R backtest</p>
        </div>
        {msg && <span className="text-xs text-gray-300">{msg}</span>}
      </div>

      {/* Settings (collapsed by default) */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
        <button onClick={() => setShowSettings(v => !v)}
          className="w-full flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-500 hover:text-gray-300">
          <span>Settings (all configurable)</span>
          {showSettings ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {showSettings && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mt-3">
          <Field label="Universe">
            <select value={cfg.universe} onChange={e => set("universe", e.target.value)} className={inp}>
              {universes.map(u => <option key={u.key} value={u.key}>{u.label} ({u.count})</option>)}
            </select>
          </Field>
          <Field label="Direction">
            <select value={cfg.direction} onChange={e => set("direction", e.target.value as GrConfig["direction"])} className={inp}>
              <option value="both">Both</option><option value="bull">Long only</option><option value="bear">Short only</option>
            </select>
          </Field>
          <Field label="EMA length"><input type="number" value={cfg.ema_length} onChange={e => set("ema_length", num(e.target.value, 2))} className={inp} /></Field>
          <Field label="RSI length"><input type="number" value={cfg.rsi_length} onChange={e => set("rsi_length", num(e.target.value, 2))} className={inp} /></Field>
          <Field label="RSI-MA length"><input type="number" value={cfg.rsi_ma_length} onChange={e => set("rsi_ma_length", num(e.target.value, 1))} className={inp} /></Field>
          <Field label="Gap %"><input type="number" step="0.1" value={cfg.gap_pct} onChange={e => set("gap_pct", num(e.target.value))} className={inp} /></Field>
          <Field label="Band upper"><input type="number" value={cfg.band_upper} onChange={e => set("band_upper", num(e.target.value))} className={inp} /></Field>
          <Field label="Band middle"><input type="number" value={cfg.band_middle} onChange={e => set("band_middle", num(e.target.value))} className={inp} /></Field>
          <Field label="Band lower"><input type="number" value={cfg.band_lower} onChange={e => set("band_lower", num(e.target.value))} className={inp} /></Field>
          <Field label="R:R targets (csv)">
            <input value={cfg.rr_targets.join(",")} onChange={e => set("rr_targets", e.target.value.split(",").map(x => Number(x.trim())).filter(x => x > 0))} className={inp} />
          </Field>
          <Field label="Max hold (bars)"><input type="number" value={cfg.max_hold_bars} onChange={e => set("max_hold_bars", num(e.target.value, 1))} className={inp} /></Field>
          <Field label="Watch enabled">
            <label className="flex items-center gap-2 text-xs text-gray-200 h-[30px]">
              <input type="checkbox" checked={cfg.watch_enabled} onChange={e => set("watch_enabled", e.target.checked)} className="accent-brand-500" /> on
            </label>
          </Field>
          <Field label="Watch EOD send (IST)"><input type="time" value={cfg.watch_eod_time} onChange={e => set("watch_eod_time", e.target.value)} className={inp} /></Field>
          <Field label="Morning gap check (IST)"><input type="time" value={cfg.watch_open_time} onChange={e => set("watch_open_time", e.target.value)} className={inp} /></Field>
          <div className="flex items-end">
            <button onClick={save} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 rounded bg-gray-800 border border-gray-700 text-gray-200 hover:text-white text-xs disabled:opacity-50">
              {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />} Save
            </button>
          </div>
        </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 text-xs">
        {([["watch", "Entry for tomorrow"], ["backtest", "Backtest"]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded border ${tab === t ? "bg-brand-600 border-brand-500 text-white" : "bg-gray-800 border-gray-700 text-gray-300 hover:text-white"}`}>{label}</button>
        ))}
      </div>

      {tab === "watch" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={doWatchUpdate} disabled={watchUpdating} className="flex items-center gap-1 px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-500 text-white text-xs disabled:opacity-50">
              {watchUpdating ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />} {watchUpdating ? "Refreshing (fetching F&O)…" : "Update now"}
            </button>
            <button onClick={doWatchSend} disabled={watchSending} className="flex items-center gap-1 px-3 py-1.5 rounded border border-gray-700 text-gray-200 hover:text-white text-xs disabled:opacity-50" title="Send the current watchlist to Telegram now">
              {watchSending ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />} Send to Telegram
            </button>
            {watch && <span className="text-xs text-gray-400">{watch.rows.length} stock(s) · {watch.rows.filter(r => r.direction === "oversold").length} long / {watch.rows.filter(r => r.direction === "overbought").length} short</span>}
          </div>
          <p className="text-[11px] text-gray-500">
            F&amp;O stocks with RSI-on-EMA ≥ {cfg.band_upper} (short setup) or ≤ {cfg.band_lower} (long setup), kept until RSI crosses back inside. Live price auto-refreshes every 30s. The list is sent to Telegram at {cfg.watch_eod_time}; next-morning gap-entry alerts run at {cfg.watch_open_time} (fallback 09:15).
          </p>
          {watch && (
            <div className="overflow-x-auto rounded-lg border border-gray-800">
              <table className="w-full text-xs">
                <thead className="bg-gray-900 text-gray-400"><tr>
                  <th className="px-2 py-2 w-6"></th><th className="px-3 py-2 text-left">Symbol</th><th className="px-3 py-2 text-left">Setup</th>
                  <th className="px-3 py-2 text-right">RSI</th><th className="px-3 py-2 text-left">Since</th>
                  <th className="px-3 py-2 text-right">Prev close</th><th className="px-3 py-2 text-right">Current</th>
                  <th className="px-3 py-2 text-right">Day %</th><th className="px-3 py-2 text-right">Gap now</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-800/60 bg-gray-950">
                  {watch.rows.length === 0 && <tr><td colSpan={9} className="text-center py-5 text-gray-500">No F&amp;O stocks in the extreme zone. Hit “Update now”.</td></tr>}
                  {watch.rows.map(r => {
                    const gapNow = r.lp != null && r.last_close ? (r.lp - r.last_close) / r.last_close * 100 : null;
                    const alignedGap = gapNow != null && ((r.direction === "oversold" && gapNow >= cfg.gap_pct) || (r.direction === "overbought" && gapNow <= -cfg.gap_pct));
                    return (
                      <>
                        <tr key={r.symbol} onClick={() => toggleChart(r.symbol)} className="hover:bg-gray-900/50 cursor-pointer">
                          <td className="px-2 py-2 text-gray-500">{loadingChart === r.symbol ? <RefreshCw size={11} className="animate-spin" /> : expanded === r.symbol ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</td>
                          <td className="px-3 py-2 font-mono text-brand-300">{r.name}</td>
                          <td className="px-3 py-2">{r.direction === "oversold" ? <span className="text-green-400 flex items-center gap-1"><TrendingUp size={12} />Long · gap-up</span> : <span className="text-red-400 flex items-center gap-1"><TrendingDown size={12} />Short · gap-down</span>}</td>
                          <td className="px-3 py-2 text-right font-mono text-gray-200">{r.rsi_ema}</td>
                          <td className="px-3 py-2 text-gray-400">{r.entered_date}</td>
                          <td className="px-3 py-2 text-right font-mono text-gray-300">{inr(r.last_close)}</td>
                          <td className="px-3 py-2 text-right font-mono text-gray-200">{r.lp != null ? inr(r.lp) : "—"}</td>
                          <td className={`px-3 py-2 text-right font-mono ${rColor(r.chp ?? 0)}`}>{r.chp != null ? `${r.chp > 0 ? "+" : ""}${r.chp}%` : "—"}</td>
                          <td className={`px-3 py-2 text-right font-mono ${alignedGap ? "text-amber-300 font-semibold" : "text-gray-500"}`}>{gapNow != null ? `${gapNow > 0 ? "+" : ""}${gapNow.toFixed(2)}%${alignedGap ? " ⚡" : ""}` : "—"}</td>
                        </tr>
                        {expanded === r.symbol && (
                          <tr><td colSpan={9} className="px-3 py-3 bg-gray-950">
                            {chartCache[r.symbol]
                              ? <GapReversalChart candles={chartCache[r.symbol].candles} shapes={chartCache[r.symbol].shapes} rsi={chartCache[r.symbol].rsi} bands={chartCache[r.symbol].bands} height={440} />
                              : <div className="text-gray-500 text-xs">Loading chart…</div>}
                          </td></tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!watch && <div className="text-gray-500 text-sm">Loading watchlist…</div>}
        </div>
      )}

      {tab === "backtest" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button onClick={doBacktest} disabled={btRunning} className="flex items-center gap-1 px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-500 text-white text-xs disabled:opacity-50">
              {btRunning ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />} {btRunning ? "Backtesting…" : "Run backtest"}
            </button>
            {bt && <span className="text-xs text-gray-400">{bt.total_signals.toLocaleString()} signals · {bt.scanned} stocks · {bt.at?.slice(0, 16).replace("T", " ")}</span>}
          </div>

          {bt && btStats && (
            <>
              <div className="flex items-center gap-1 text-xs">
                {(["ALL", "BULL", "BEAR"] as const).map(d => (
                  <button key={d} onClick={() => setDir(d)} className={`px-2.5 py-1 rounded border ${dir === d ? "bg-gray-700 border-gray-600 text-white" : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white"}`}>{d === "ALL" ? "All" : d === "BULL" ? "Long" : "Short"}</button>
                ))}
              </div>
              <div className="overflow-x-auto rounded-lg border border-gray-800">
                <table className="w-full text-xs">
                  <thead className="bg-gray-900 text-gray-400"><tr>
                    <th className="px-3 py-2 text-left">Exit rule</th><th className="px-3 py-2 text-right">Signals</th>
                    <th className="px-3 py-2 text-right">Win %</th><th className="px-3 py-2 text-right">Wins</th>
                    <th className="px-3 py-2 text-right">Losses</th><th className="px-3 py-2 text-right">Timeouts</th>
                    <th className="px-3 py-2 text-right">Total R</th><th className="px-3 py-2 text-right">Avg R</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-800/60 bg-gray-950">
                    {exits.map(e => { const s = btStats[e]; if (!s) return null; return (
                      <tr key={e} className="hover:bg-gray-900/60">
                        <td className="px-3 py-2 font-medium text-gray-200">{exitLabel(e)}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-300">{s.signals.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-200">{s.win_rate}%</td>
                        <td className="px-3 py-2 text-right font-mono text-green-400">{s.wins}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-400">{s.losses}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-500">{s.timeouts}</td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold ${rColor(s.total_R)}`}>{s.total_R > 0 ? "+" : ""}{inr(s.total_R)}R</td>
                        <td className={`px-3 py-2 text-right font-mono ${rColor(s.avg_R)}`}>{s.avg_R > 0 ? "+" : ""}{s.avg_R}</td>
                      </tr>); })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-500">Total R = sum of R multiples (win = +target, stop = −1). A positive Total R means the rule was net-profitable on this data. Same-bar target+stop counts as a loss.</p>

              {/* per-stock */}
              <div className="text-[10px] uppercase tracking-wider text-gray-500 pt-1">Most-active stocks (Total R per exit)</div>
              <div className="overflow-x-auto rounded-lg border border-gray-800">
                <table className="w-full text-xs">
                  <thead className="bg-gray-900 text-gray-400"><tr>
                    <th className="px-2 py-2 w-6"></th><th className="px-3 py-2 text-left">Symbol</th><th className="px-3 py-2 text-right">Signals</th>
                    {exits.map(e => <th key={e} className="px-3 py-2 text-right">{exitLabel(e)}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-gray-800/60 bg-gray-950">
                    {bt.per_stock.slice(0, 40).map(r => (
                      <>
                        <tr key={r.symbol} onClick={() => toggleChart(r.symbol)} className="hover:bg-gray-900/50 cursor-pointer">
                          <td className="px-2 py-2 text-gray-500">{loadingChart === r.symbol ? <RefreshCw size={11} className="animate-spin" /> : expanded === r.symbol ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</td>
                          <td className="px-3 py-2 font-mono text-brand-300">{r.symbol}</td>
                          <td className="px-3 py-2 text-right font-mono text-gray-300">{r.signals}</td>
                          {exits.map(e => <td key={e} className={`px-3 py-2 text-right font-mono ${rColor(r.total_R[e] ?? 0)}`}>{(r.total_R[e] ?? 0) > 0 ? "+" : ""}{inr(r.total_R[e] ?? 0)}</td>)}
                        </tr>
                        {expanded === r.symbol && (
                          <tr><td colSpan={3 + exits.length} className="px-3 py-3 bg-gray-950">
                            {chartCache[r.symbol]
                              ? <GapReversalChart candles={chartCache[r.symbol].candles} shapes={chartCache[r.symbol].shapes} rsi={chartCache[r.symbol].rsi} bands={chartCache[r.symbol].bands} height={440} />
                              : <div className="text-gray-500 text-xs">Loading chart…</div>}
                          </td></tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!bt && !btRunning && <div className="text-gray-500 text-sm">Run the backtest to see the success/failure breakdown across exit rules.</div>}
        </div>
      )}

    </div>
  );
}
