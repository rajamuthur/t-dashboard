"use client";
import { useCallback, useEffect, useState } from "react";
import { Play, RefreshCw, Send, ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Target, BadgeCheck } from "lucide-react";
import PatternShapeChart from "@/components/PatternShapeChart";
import {
  PatternRow, PatternDetail, Timeframe, PatternStats, Universe,
  runPatternScan, getPatternScanStatus, listPatterns, getPatternDetail,
  getPatternStats, sendPatternCharts, getUniverses,
} from "@/lib/patternsApi";
import { fmtIsoDate } from "@/lib/dates";

// VCP is a weeks-long base pattern → daily & weekly are primary; monthly is
// offered but rarely forms a clean contraction on this universe.
const TIMEFRAMES: Timeframe[] = ["day", "week", "month"];
const DURATIONS = [{ v: 3, label: "3 mo" }, { v: 6, label: "6 mo" }, { v: 12, label: "1 yr" }];
const ANALYSIS = "vcp";
const POLL_MS = 2500;

function pnlColor(p: number | null | undefined) {
  if (p == null || p === 0) return "text-gray-300";
  return p > 0 ? "text-green-400" : "text-red-400";
}
function outcomeBadge(o: string | null) {
  const map: Record<string, string> = {
    success: "bg-green-500/15 text-green-300",
    failure: "bg-red-500/15 text-red-300",
    open: "bg-gray-600/30 text-gray-300",
    no_trade: "bg-amber-500/10 text-amber-300/80",
  };
  return map[o ?? ""] ?? "bg-gray-700/30 text-gray-400";
}
function volBadge(v: string | undefined) {
  if (v === "dry-up") return "bg-emerald-500/15 text-emerald-300";
  if (v === "flat") return "bg-gray-600/30 text-gray-300";
  return "bg-gray-700/30 text-gray-500";
}
function cleanSym(s: string) { return s.replace("NSE:", "").replace("-EQ", ""); }

function StatCard({ label, value, tone, sub }: { label: string; value: number | string; tone: "pos" | "neg" | "neutral" | "muted"; sub?: string }) {
  const color = tone === "pos" ? "text-green-400" : tone === "neg" ? "text-red-400" : tone === "muted" ? "text-gray-500" : "text-gray-100";
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-xl font-semibold font-mono tabular-nums mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

type SortKey = "symbol" | "candle_date" | "outcome";

export default function VcpPage() {
  const [timeframe, setTimeframe] = useState<Timeframe>("day");
  const [universe, setUniverse] = useState<string>("fo");
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [minMonths, setMinMonths] = useState<number>(3);
  const [rows, setRows] = useState<PatternRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<PatternStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortKey>("candle_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [symbolFilter, setSymbolFilter] = useState("");

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailCache, setDetailCache] = useState<Record<number, PatternDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<number | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { getUniverses().then(setUniverses).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data, total }, st] = await Promise.all([
        listPatterns({
          analysis_type: ANALYSIS, timeframe, universe,
          outcome: outcomeFilter || undefined,
          symbol_filter: symbolFilter || undefined,
          sort_by: sortBy, sort_dir: sortDir, limit: 200,
        }),
        getPatternStats({ analysis_type: ANALYSIS, timeframe, universe, symbol_filter: symbolFilter || undefined }),
      ]);
      setRows(data); setTotal(total); setStats(st);
    } finally { setLoading(false); }
  }, [timeframe, universe, outcomeFilter, symbolFilter, sortBy, sortDir]);

  useEffect(() => { load(); }, [load]);

  // Reset selection + collapse detail when the view changes (wrong-chart guard).
  useEffect(() => { setSelected(new Set()); setExpandedId(null); }, [timeframe, universe, outcomeFilter, symbolFilter]);

  async function runScan() {
    setRunning(true); setMsg(null); setStatus("Starting…");
    try {
      await runPatternScan(ANALYSIS, timeframe, universe, minMonths);
      for (let i = 0; i < 160; i++) {
        await new Promise(r => setTimeout(r, POLL_MS));
        const st = await getPatternScanStatus();
        setStatus(st.step || st.status || "");
        if (st.status === "completed") { await load(); break; }
        if (st.status === "failed") { setMsg("Scan failed: " + (st.message || "")); break; }
      }
    } catch (e: any) {
      setMsg("Error: " + (e?.message || "scan failed").replace(/^API \d+:\s*/, ""));
    } finally { setRunning(false); setStatus(""); }
  }

  function toggleSort(k: SortKey) {
    if (sortBy === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(k); setSortDir("desc"); }
  }
  function toggleSelect(id: number) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleRowClick(r: PatternRow) {
    if (expandedId === r.id) { setExpandedId(null); return; }
    setExpandedId(r.id);
    if (detailCache[r.id]) return;
    setLoadingDetail(r.id);
    try {
      const d = await getPatternDetail(r.id);
      setDetailCache(p => ({ ...p, [r.id]: d }));
    } finally { setLoadingDetail(null); }
  }

  async function sendOne(id: number) {
    setSending(true); setMsg(null);
    try {
      const res = await sendPatternCharts([id], `🎯 VCP Setup (${timeframe})`);
      setMsg(`Sent ${res.sent} chart to Telegram${res.failed ? ` (${res.failed} failed)` : ""}`);
      setTimeout(() => setMsg(null), 4000);
    } catch (e: any) {
      setMsg("Error: " + (e?.message || "send failed").replace(/^API \d+:\s*/, ""));
    } finally { setSending(false); }
  }

  async function sendSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setSending(true); setMsg(null);
    try {
      const res = await sendPatternCharts(ids, `🎯 VCP Setups (${timeframe})`);
      setMsg(`Sent ${res.sent} chart(s) to Telegram${res.failed ? ` (${res.failed} failed)` : ""}`);
      setSelected(new Set());
      setTimeout(() => setMsg(null), 4000);
    } catch (e: any) {
      setMsg("Error: " + (e?.message || "send failed").replace(/^API \d+:\s*/, ""));
    } finally { setSending(false); }
  }

  const allChecked = rows.length > 0 && rows.every(r => selected.has(r.id));
  function SortTh({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) {
    const Icon = sortBy !== k ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th className={`px-3 py-2 cursor-pointer select-none hover:text-gray-200 ${right ? "text-right" : "text-left"}`} onClick={() => toggleSort(k)}>
        <span className="inline-flex items-center gap-1">{children}<Icon size={11} className={sortBy === k ? "text-brand-400" : "text-gray-600"} /></span>
      </th>
    );
  }

  const COLS = 13;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><Target size={20} className="text-brand-500" /> VCP Scanner</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Minervini Volatility Contraction Pattern — every match clears the full 8-point Trend Template (Stage-2 uptrend) gate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button onClick={sendSelected} disabled={sending}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50">
              {sending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
              Send {selected.size} to Telegram
            </button>
          )}
          <button onClick={runScan} disabled={running}
            className="flex items-center gap-2 px-5 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white">
            {running ? <><RefreshCw size={15} className="animate-spin" /> Scanning…</> : <><Play size={15} /> Run Scan</>}
          </button>
        </div>
      </div>

      {/* Methodology note */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3 text-xs text-gray-400 leading-relaxed">
        A VCP is <span className="text-gray-200">2–6 progressively tighter pullbacks ("Ts")</span>, each roughly half the prior,
        with <span className="text-gray-200">volume drying up</span> at the tightest, right-side contraction. The
        <span className="text-emerald-300"> pivot</span> = high of the last contraction; the signal triggers on a
        <span className="text-emerald-300"> breakout</span> above it. Footprint reads <span className="font-mono text-gray-300">Time(W) Deepest/Tightest Ts</span> —
        e.g. <span className="font-mono text-gray-300">40W 31/3 4T</span>. Stop sits below the final low; target is a measured move.
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {TIMEFRAMES.map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)}
              className={`px-3 py-1.5 rounded-lg text-sm capitalize border ${timeframe === tf ? "bg-brand-600 border-brand-500 text-white" : "bg-gray-800 border-gray-700 text-gray-300 hover:text-white"}`}>
              {tf === "day" ? "Daily" : tf === "week" ? "Weekly" : "Monthly"}
            </button>
          ))}
        </div>
        <select value={universe} onChange={e => setUniverse(e.target.value)}
          title="Stock universe to scan / show"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white">
          {(universes.length ? universes : [{ key: "fo", label: "F&O", count: 0 }]).map(u => (
            <option key={u.key} value={u.key}>{u.label}{u.count ? ` (${u.count})` : ""}</option>
          ))}
        </select>
        <select value={minMonths} onChange={e => setMinMonths(Number(e.target.value))}
          title="Minimum base duration for the next scan"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white">
          {DURATIONS.map(d => <option key={d.v} value={d.v}>Min {d.label}</option>)}
        </select>
        <input value={symbolFilter} onChange={e => setSymbolFilter(e.target.value)} placeholder="Symbol…"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 w-32" />
        <select value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white">
          <option value="">All outcomes</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
          <option value="open">Open</option>
          <option value="no_trade">No-trade</option>
        </select>
        <span className="ml-auto text-xs text-gray-500">{total} setup{total !== 1 ? "s" : ""}{running && status ? ` · ${status}` : ""}</span>
      </div>

      {/* Dashboard counts */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Success" value={stats.success} tone="pos" sub="broke out → target" />
          <StatCard label="Failure" value={stats.failure} tone="neg" sub="stopped out" />
          <StatCard label="Open" value={stats.open} tone="neutral" sub="in progress" />
          <StatCard label="No-trade" value={stats.no_trade} tone="muted" sub="never broke out" />
          <StatCard label="Win rate" value={stats.win_rate != null ? `${stats.win_rate}%` : "—"} tone={stats.win_rate != null && stats.win_rate >= 50 ? "pos" : "neg"} sub="success / resolved" />
        </div>
      )}

      {msg && (
        <div className={`text-xs px-3 py-2 rounded-lg ${msg.startsWith("Error") ? "bg-red-950/40 text-red-300" : "bg-green-950/40 text-green-300"}`}>{msg}</div>
      )}

      {/* Table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-gray-400 text-xs border-b border-gray-800">
            <tr>
              <th className="w-8 px-3 py-2">
                <input type="checkbox" className="w-3.5 h-3.5 accent-sky-500"
                  checked={allChecked}
                  onChange={e => setSelected(prev => { const n = new Set(prev); rows.forEach(r => e.target.checked ? n.add(r.id) : n.delete(r.id)); return n; })} />
              </th>
              <th className="w-6 px-2 py-2" />
              <SortTh k="symbol">Symbol</SortTh>
              <th className="px-3 py-2 text-left">Footprint</th>
              <th className="px-3 py-2 text-center">T's</th>
              <th className="px-3 py-2 text-right">Deep→Tight</th>
              <th className="px-3 py-2 text-right">Entry</th>
              <th className="px-3 py-2 text-right">Stop</th>
              <th className="px-3 py-2 text-right">Target</th>
              <th className="px-3 py-2 text-right">Exit</th>
              <th className="px-3 py-2 text-center">Vol</th>
              <th className="px-3 py-2 text-right">P&L %</th>
              <SortTh k="outcome">Outcome</SortTh>
              <SortTh k="candle_date">Date</SortTh>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={COLS + 1} className="text-center py-10 text-gray-500">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={COLS + 1} className="text-center py-10 text-gray-500">No VCP setups yet. Pick a timeframe and click <span className="text-white">Run Scan</span>.</td></tr>
            )}
            {!loading && rows.map(r => {
              const expanded = expandedId === r.id;
              const det = detailCache[r.id];
              const d = r.details ?? {};
              return [
                <tr key={r.id} onClick={() => handleRowClick(r)}
                  className={`border-b border-gray-800/60 hover:bg-gray-800/40 cursor-pointer ${selected.has(r.id) ? "bg-sky-500/5" : ""}`}>
                  <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="w-3.5 h-3.5 accent-sky-500" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                  </td>
                  <td className="px-2 py-2 text-gray-500">
                    {loadingDetail === r.id ? <RefreshCw size={12} className="animate-spin" /> : expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </td>
                  <td className="px-3 py-2 font-medium text-white">
                    {cleanSym(r.symbol)}
                    <BadgeCheck size={12} className="inline ml-1 text-emerald-400" aria-label="Trend Template ✓" />
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-300">{d.footprint ?? "—"}</td>
                  <td className="px-3 py-2 text-center text-gray-200">{d.t_count ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-300">
                    {d.deepest_pct != null && d.tightest_pct != null ? `${d.deepest_pct}% → ${d.tightest_pct}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-300">{r.entry ?? d.pivot ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-300">{d.stop_loss ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-blue-300">{d.target ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-200">{r.exit ?? "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${volBadge(d.volume_trend)}`}>{d.volume_trend ?? "—"}</span>
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${pnlColor(r.pnl_pct)}`}>{r.pnl_pct != null ? r.pnl_pct.toFixed(2) + "%" : "—"}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${outcomeBadge(r.outcome)}`}>{r.outcome ? r.outcome.replace("_", " ") : "—"}</span></td>
                  <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{fmtIsoDate(r.candle_date)}</td>
                </tr>,
                expanded && (
                  <tr key={`${r.id}-d`} className="bg-gray-950 border-b border-gray-800">
                    <td colSpan={COLS + 1} className="px-5 py-4">
                      {det ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-gray-400">
                              {cleanSym(r.symbol)} · {r.timeframe} · <span className="font-mono text-gray-300">{d.footprint}</span> ·
                              contractions <span className="text-gray-200 font-mono">{Array.isArray(d.contractions) ? d.contractions.join("→") + "%" : "—"}</span> ·
                              pivot <span className="text-emerald-300 font-mono">{det.entry_close}</span> ·
                              stop <span className="text-red-300 font-mono">{det.stop_loss}</span> ·
                              target <span className="text-blue-300 font-mono">{det.target}</span> ·
                              <span className="text-emerald-300"> Trend Template ✓</span>
                            </div>
                            <button
                              onClick={() => sendOne(r.id)}
                              disabled={sending}
                              className="flex items-center gap-1 px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs disabled:opacity-50 shrink-0">
                              <Send size={12} /> Send chart
                            </button>
                          </div>
                          <PatternShapeChart candles={det.candles} shapes={det.shapes} height={340} focusDate={r.candle_date} />
                        </div>
                      ) : (
                        <div className="text-gray-500 text-sm py-6 text-center">Loading chart…</div>
                      )}
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
