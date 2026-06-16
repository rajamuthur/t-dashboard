"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Play, RefreshCw, ChevronDown, ChevronRight, Clock,
  TrendingDown, Search, X, Activity, Send,
} from "lucide-react";
import {
  runDailyScan, getDailyScanStatus, getDailyScanSessions, getDailyResults,
  getDailyScanDetail, DailyScanSession, DailyScanResult, DailyScanDetail,
  AIAnalysis, DailyScanStatus,
} from "@/lib/api";
import { sendToTelegram } from "@/lib/telegramApi";
import { getUniverses, Universe } from "@/lib/patternsApi";
import PatternShapeChart, { PatternShape } from "./PatternShapeChart";
import AIAnalysisPanel from "./AIAnalysisPanel";

const POLL_MS = 3000;

function BiasBadge({ bias }: { bias?: string }) {
  if (!bias) return <span className="text-gray-600">—</span>;
  const map: Record<string, string> = {
    accumulation: "bg-green-500/15 text-green-300",
    distribution: "bg-red-500/15 text-red-300",
    neutral: "bg-gray-600/30 text-gray-400",
  };
  return <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${map[bias] ?? map.neutral}`}>{bias}</span>;
}

export default function DailyAnalysisPage() {
  const [sessions,        setSessions]        = useState<DailyScanSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [results,         setResults]         = useState<DailyScanResult[]>([]);
  const [total,           setTotal]           = useState(0);
  const [page,            setPage]            = useState(0);
  const PAGE_SIZE = 50;

  const [universe,     setUniverse]     = useState("fo");
  const [universes,    setUniverses]    = useState<Universe[]>([]);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [fromDate,     setFromDate]     = useState("");
  const [toDate,       setToDate]       = useState("");
  const [sortBy,       setSortBy]       = useState("candle_date");
  const [sortDir,      setSortDir]      = useState<"asc" | "desc">("desc");

  const [scanStatus,  setScanStatus]  = useState<DailyScanStatus | null>(null);
  const [running,     setRunning]     = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [expandedId,   setExpandedId]   = useState<number | null>(null);
  const [detailCache,  setDetailCache]  = useState<Record<number, DailyScanDetail>>({});
  const [aiCache,      setAiCache]      = useState<Record<number, AIAnalysis>>({});
  const [loadingDetail, setLoadingDetail] = useState<number | null>(null);

  // Telegram selection
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending,  setSending]  = useState(false);
  const [sendMsg,  setSendMsg]  = useState<string | null>(null);

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function sendSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setSending(true); setSendMsg(null);
    try {
      await sendToTelegram("scans", ids, "📊 Daily Patterns");
      setSendMsg(`Sent ${ids.length} signal(s) to Telegram`);
      setSelected(new Set());
      setTimeout(() => setSendMsg(null), 3000);
    } catch (e: any) {
      setSendMsg(`Error: ${(e?.message || "Send failed").replace(/^API \d+:\s*/, "")}`);
    } finally { setSending(false); }
  }

  useEffect(() => { getUniverses().then(setUniverses).catch(() => {}); }, []);

  // Load sessions on mount
  useEffect(() => {
    getDailyScanSessions("tight_range", 50)
      .then(s => {
        const safe = Array.isArray(s) ? s : [];
        setSessions(safe);
        if (safe.length > 0) setSelectedSession(safe[0].id);
      })
      .catch(() => {});
  }, []);

  // Load results whenever filters / session change
  const loadResults = useCallback(async () => {
    try {
      const { data, total } = await getDailyResults({
        analysis_type: "tight_range",
        session_id:    selectedSession ?? undefined,
        symbol_filter: symbolFilter || undefined,
        universe:      universe || undefined,
        from_date:     fromDate || undefined,
        to_date:       toDate   || undefined,
        sort_by:       sortBy,
        sort_dir:      sortDir,
        limit:         PAGE_SIZE,
        offset:        page * PAGE_SIZE,
      });
      setResults(Array.isArray(data) ? data : []);
      setTotal(typeof total === "number" ? total : 0);
    } catch {}
  }, [selectedSession, universe, symbolFilter, fromDate, toDate, sortBy, sortDir, page]);

  useEffect(() => { loadResults(); }, [loadResults]);

  // Polling while scan is running
  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const s = await getDailyScanStatus();
        setScanStatus(s);
        if (s.status === "completed" || s.status === "failed") {
          stopPolling();
          setRunning(false);
          // Refresh sessions then results
          const raw = await getDailyScanSessions("tight_range", 50);
          const newSessions = Array.isArray(raw) ? raw : [];
          setSessions(newSessions);
          if (newSessions.length > 0) setSelectedSession(newSessions[0].id);
          setPage(0);
        }
      } catch {}
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => () => stopPolling(), []);

  async function handleRunScan() {
    setRunning(true);
    setScanStatus({ status: "running", step: "Starting…" });
    try {
      await runDailyScan("tight_range", universe);
      startPolling();
    } catch {
      setRunning(false);
      setScanStatus({ status: "failed", message: "Failed to start scan" });
    }
  }

  async function handleRowClick(result: DailyScanResult) {
    if (expandedId === result.id) { setExpandedId(null); return; }
    setExpandedId(result.id);
    if (detailCache[result.id]) return;
    setLoadingDetail(result.id);
    try {
      const detail = await getDailyScanDetail(result.id);
      setDetailCache(p => ({ ...p, [result.id]: detail }));
    } catch {}
    finally { setLoadingDetail(null); }
  }

  function toggleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
    setPage(0);
  }

  function clearFilters() {
    setSymbolFilter(""); setFromDate(""); setToDate(""); setPage(0);
  }

  const hasFilters = symbolFilter || fromDate || toDate;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentSession = sessions.find(s => s.id === selectedSession);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity size={20} className="text-brand-400" />
            <h1 className="text-xl font-bold text-white">Daily Patterns</h1>
          </div>
          <p className="text-sm text-gray-400 mt-0.5">Tight range + volume compression setup on F&O stocks</p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              onClick={sendSelected}
              disabled={sending}
              className="flex items-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition"
              title="Send selected signals to Telegram"
            >
              {sending ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
              Send {selected.size} to Telegram
            </button>
          )}
          <button
            onClick={handleRunScan}
            disabled={running}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition"
          >
            {running
              ? <><RefreshCw size={15} className="animate-spin" /> Scanning…</>
              : <><Play size={15} /> Run Scan</>}
          </button>
        </div>
      </div>

      {sendMsg && (
        <div className={`text-xs px-3 py-2 rounded-lg ${sendMsg.startsWith("Error") ? "bg-red-950/40 text-red-300" : "bg-green-950/40 text-green-300"}`}>
          {sendMsg}
        </div>
      )}

      {/* Scan progress */}
      {scanStatus && scanStatus.status === "running" && (
        <div className="flex items-center gap-3 p-3 bg-brand-900/30 border border-brand-700/40 rounded-lg text-sm text-brand-300">
          <RefreshCw size={14} className="animate-spin shrink-0" />
          <span>{scanStatus.step ?? "Scanning…"}</span>
          {(scanStatus.total ?? 0) > 0 && (
            <span className="ml-auto text-xs text-gray-400">
              {scanStatus.matched ?? 0} matched / {scanStatus.total} stocks
            </span>
          )}
        </div>
      )}

      {/* Session selector + stats */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={universe}
          onChange={e => { setUniverse(e.target.value); setPage(0); }}
          title="Stock universe to scan / show"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand-500"
        >
          {(universes.length ? universes : [{ key: "fo", label: "F&O", count: 0 }]).map(u => (
            <option key={u.key} value={u.key}>{u.label}{u.count ? ` (${u.count})` : ""}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-gray-400" />
          <select
            value={selectedSession ?? ""}
            onChange={e => { setSelectedSession(e.target.value ? Number(e.target.value) : null); setPage(0); }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand-500"
          >
            <option value="">All history</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>
                {s.scan_date} — {s.matched_count} matched
                {s.status !== "completed" ? ` (${s.status})` : ""}
              </option>
            ))}
          </select>
        </div>

        {currentSession && (
          <div className="flex gap-4 text-sm">
            <span className="text-gray-400">
              Scanned: <span className="text-white">{currentSession.total_stocks}</span>
            </span>
            <span className="text-gray-400">
              Matched: <span className="text-green-400 font-medium">{currentSession.matched_count}</span>
            </span>
            <span className="text-gray-400">
              Date: <span className="text-white">{currentSession.scan_date}</span>
            </span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button onClick={loadResults} title="Refresh" className="p-1.5 text-gray-400 hover:text-white transition">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Symbol…"
            value={symbolFilter}
            onChange={e => { setSymbolFilter(e.target.value); setPage(0); }}
            className="bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 w-36"
          />
        </div>
        <input
          type="date" value={fromDate}
          onChange={e => { setFromDate(e.target.value); setPage(0); }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand-500"
        />
        <span className="text-gray-500 text-sm">to</span>
        <input
          type="date" value={toDate}
          onChange={e => { setToDate(e.target.value); setPage(0); }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand-500"
        />
        {hasFilters && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition">
            <X size={12} /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-500">{total} result{total !== 1 ? "s" : ""}</span>
      </div>

      {/* Results table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wide">
              <th className="w-8 px-3 py-3">
                <input type="checkbox" className="w-3.5 h-3.5 accent-sky-500 align-middle" title="Select all shown"
                  checked={results.length > 0 && results.every(r => selected.has(r.id))}
                  onChange={e => setSelected(prev => {
                    const next = new Set(prev);
                    if (e.target.checked) results.forEach(r => next.add(r.id));
                    else results.forEach(r => next.delete(r.id));
                    return next;
                  })} />
              </th>
              <th className="w-8 px-4 py-3" />
              <SortTh label="Symbol"   col="symbol"      sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
              <th className="px-4 py-3 text-right">Close ₹</th>
              <th className="px-4 py-3 text-right">Band %</th>
              <th className="px-4 py-3 text-right">RSI</th>
              <th className="px-4 py-3 text-right">Vol Ratio</th>
              <th className="px-4 py-3 text-right">Wick %</th>
              <th className="px-4 py-3 text-center">Bias</th>
              <SortTh label="Date"     col="candle_date" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} right />
              <th className="px-4 py-3 text-center">AI</th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center py-12 text-gray-500">
                  {sessions.length === 0
                    ? 'No scans yet. Click "Run Scan" to start.'
                    : "No results match the current filters."}
                </td>
              </tr>
            )}
            {results.map(r => {
              const d        = r.details;
              const expanded = expandedId === r.id;
              const detail   = detailCache[r.id];

              return [
                <tr
                  key={r.id}
                  onClick={() => handleRowClick(r)}
                  className={`border-b border-gray-800/60 hover:bg-gray-800/40 cursor-pointer transition ${selected.has(r.id) ? "bg-sky-500/5" : ""}`}
                >
                  <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="w-3.5 h-3.5 accent-sky-500 align-middle"
                      checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                  </td>
                  <td className="pl-4 py-3 text-gray-500">
                    {loadingDetail === r.id
                      ? <RefreshCw size={13} className="animate-spin" />
                      : expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </td>
                  <td className="px-4 py-3 font-medium text-white">
                    {r.symbol.replace("NSE:", "").replace("-EQ", "")}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-200">
                    {d ? `₹${d.entry_close.toLocaleString("en-IN")}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <BandBadge value={d?.band_pct} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RsiBadge value={d?.rsi} />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    <span className="flex items-center justify-end gap-1">
                      <TrendingDown size={11} className="text-green-400" />
                      {d ? `${d.vol_ratio.toFixed(2)}x` : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {d ? `${d.big_wick_ratio}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-center"><BiasBadge bias={d?.bias} /></td>
                  <td className="px-4 py-3 text-right text-gray-400">{r.candle_date}</td>
                  <td className="px-4 py-3 text-center">
                    {r.has_ai_analysis
                      ? <span className="inline-block w-2 h-2 rounded-full bg-green-400" title="AI analysis available" />
                      : <span className="inline-block w-2 h-2 rounded-full bg-gray-600" title="No AI analysis" />}
                  </td>
                </tr>,

                expanded && (
                  <tr key={`${r.id}-detail`} className="bg-gray-900/80 border-b border-gray-800">
                    <td colSpan={11} className="px-6 py-5">
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {/* Chart */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs text-gray-500 uppercase tracking-wide">Daily Chart · indicators + fullscreen</p>
                            {d?.bias && (
                              <span className="flex items-center gap-1.5 text-xs text-gray-400">
                                <BiasBadge bias={d.bias} />
                                {d.close_loc_pct != null && <span>close @ {d.close_loc_pct}% of range</span>}
                              </span>
                            )}
                          </div>
                          {detail ? (
                            <PatternShapeChart
                              candles={detail.candles}
                              shapes={(d ? [
                                { type: "hline", price: d.band_high,   color: "#3b82f6", label: "Band high" },
                                { type: "hline", price: d.entry_close,  color: "#22c55e", label: "Entry" },
                                { type: "hline", price: d.stop_loss,    color: "#ef4444", label: "Stop (band low)" },
                              ] : []) as PatternShape[]}
                              height={300}
                            />
                          ) : (
                            <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
                              Loading chart…
                            </div>
                          )}
                          {/* Key levels */}
                          {d && (
                            <div className="grid grid-cols-3 gap-3 mt-3">
                              <KeyLevel label="Entry"      value={d.entry_close} color="text-green-400" prefix="₹" />
                              <KeyLevel label="Stop Loss"  value={d.stop_loss}   color="text-red-400"   prefix="₹" />
                              <KeyLevel label="Resistance" value={d.resistance}  color="text-blue-400"  prefix="₹" />
                            </div>
                          )}
                        </div>
                        {/* AI Analysis */}
                        <div>
                          <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">AI Analysis</p>
                          <AIAnalysisPanel
                            result={r}
                            cached={aiCache[r.id] ?? null}
                            onAnalyzed={analysis => {
                              setAiCache(p => ({ ...p, [r.id]: analysis }));
                              setResults(prev => prev.map(x => x.id === r.id ? { ...x, has_ai_analysis: true } : x));
                            }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ),
              ].filter(Boolean);
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 rounded-lg bg-gray-800 text-sm text-gray-300 disabled:opacity-40 hover:bg-gray-700 transition"
          >
            ‹ Prev
          </button>
          <span className="text-sm text-gray-400">Page {page + 1} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1.5 rounded-lg bg-gray-800 text-sm text-gray-300 disabled:opacity-40 hover:bg-gray-700 transition"
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SortTh({ label, col, sortBy, sortDir, onSort, right }: {
  label: string; col: string; sortBy: string; sortDir: string;
  onSort: (c: string) => void; right?: boolean;
}) {
  const active = sortBy === col;
  return (
    <th
      className={`px-4 py-3 cursor-pointer select-none hover:text-white transition ${right ? "text-right" : "text-left"}`}
      onClick={() => onSort(col)}
    >
      {label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </th>
  );
}

function BandBadge({ value }: { value?: number }) {
  if (value == null) return <span className="text-gray-500">—</span>;
  const color = value < 5 ? "text-green-400" : value < 8 ? "text-yellow-400" : "text-orange-400";
  return <span className={`font-medium ${color}`}>{value.toFixed(1)}%</span>;
}

function RsiBadge({ value }: { value?: number }) {
  if (value == null) return <span className="text-gray-500">—</span>;
  const color = value >= 60 ? "text-green-400" : value >= 50 ? "text-yellow-400" : "text-red-400";
  return <span className={`font-medium ${color}`}>{value.toFixed(1)}</span>;
}

function KeyLevel({ label, value, color, prefix = "" }: {
  label: string; value: number; color: string; prefix?: string;
}) {
  return (
    <div className="bg-gray-800/60 rounded-lg px-3 py-2 text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-semibold ${color}`}>{prefix}{value.toLocaleString("en-IN")}</p>
    </div>
  );
}
