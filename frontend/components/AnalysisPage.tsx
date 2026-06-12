"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  getWeekCalendar, getScansV2, getScanDetail, fetchOutcome,
  getAnalysisTypes, triggerEowScan, getEowStatus,
  ScanResultFull, ScanDetail, WeekBucket,
} from "@/lib/api";
import SyncStatus from "@/components/SyncStatus";
import OutcomeBadge from "@/components/OutcomeBadge";
import OutcomeModal from "@/components/OutcomeModal";
import {
  ChevronDown, ChevronUp, Filter, RefreshCw,
  ChevronLeft, ChevronRight, ArrowUp, ArrowDown,
  ChevronsUpDown, Zap, X, History, Send,
} from "lucide-react";
import { sendToTelegram } from "@/lib/telegramApi";
import { toast } from "sonner";
import Spinner from "@/components/Spinner";
import SyncHistoryModal from "@/components/SyncHistoryModal";

interface Props { timeframe: "week" | "month" }

const PAGE_SIZES = [25, 50, 100];
type SortField = "candle_date" | "symbol" | "outcome";
type SortDir   = "asc" | "desc";

// ── Month grouping (monthly timeframe only) ──────────────────────────────────
function groupByMonth(items: ScanResultFull[]) {
  const map = new Map<string, ScanResultFull[]>();
  for (const item of items) {
    const key = item.candle_date
      ? new Date(item.candle_date).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
      : "Unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtWeekLabel(monStr: string, friStr: string): string {
  const mon = new Date(monStr + "T00:00:00");
  const fri = new Date(friStr + "T00:00:00");
  const mStr = mon.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const fStr = fri.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return `${mStr} – ${fStr}`;
}

function periodClosed(candleDate: string, timeframe: "week" | "month"): boolean {
  const cd  = new Date(candleDate + "T00:00:00");
  const now = new Date();
  if (timeframe === "week") {
    const daysAhead = (5 - cd.getDay() + 7) % 7 || 7;
    const nextFri   = new Date(cd);
    nextFri.setDate(cd.getDate() + daysAhead);
    return now > nextFri;
  }
  const nextMonth = new Date(cd.getFullYear(), cd.getMonth() + 2, 0);
  return now > nextMonth;
}

// ── Shared signal row ────────────────────────────────────────────────────────
function SignalRow({
  item, onOpen, onFetch, fetchingId, selected, onToggleSelect,
}: {
  item: ScanResultFull;
  onOpen: (item: ScanResultFull) => void;
  onFetch: (item: ScanResultFull, e: React.MouseEvent) => void;
  fetchingId: number | null;
  selected: boolean;
  onToggleSelect: (id: number) => void;
}) {
  const risk = item.details
    ? Math.abs((item.details.entry_close ?? 0) - (item.details.stop_loss ?? 0))
    : null;
  const canFetch = !item.outcome && !!item.candle_date && periodClosed(item.candle_date, item.timeframe as "week" | "month");

  return (
    <div
      onClick={() => onOpen(item)}
      className={`grid grid-cols-[auto_2fr_1.2fr_1fr_1fr_1fr_1fr] gap-0
                 border-t border-gray-800 cursor-pointer hover:bg-gray-800/40 transition ${selected ? "bg-sky-500/5" : ""}`}
    >
      <div className="pl-4 pr-1 py-3 flex items-center" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          className="w-3.5 h-3.5 accent-sky-500"
          checked={selected}
          onChange={() => onToggleSelect(item.id)}
        />
      </div>
      <div className="px-4 py-3 flex items-center gap-2">
        <span className="font-semibold text-white text-sm">
          {item.symbol.replace("NSE:", "").replace("-EQ", "")}
        </span>
        {item.is_eow_alert ? (
          <span className="text-[10px] bg-brand-600/20 text-brand-400 border border-brand-700 rounded px-1">EOW</span>
        ) : null}
      </div>
      <div className="px-4 py-3 text-sm text-gray-300">
        {item.candle_date?.slice(0, 10) ?? "—"}
      </div>
      <div className="px-4 py-3 text-sm text-right text-green-400 font-mono">
        {item.details?.entry_close?.toFixed(2) ?? "—"}
      </div>
      <div className="px-4 py-3 text-sm text-right text-red-400 font-mono">
        {item.details?.stop_loss?.toFixed(2) ?? "—"}
      </div>
      <div className="px-4 py-3 text-sm text-right text-gray-400 font-mono">
        {risk != null ? risk.toFixed(2) : "—"}
      </div>
      <div className="px-4 py-3 flex items-center gap-2">
        <OutcomeBadge outcome={item.outcome ?? null} />
        {canFetch && (
          <button
            onClick={e => onFetch(item, e)}
            disabled={fetchingId === item.id}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-0.5 rounded transition disabled:opacity-50"
          >
            {fetchingId === item.id ? <RefreshCw size={10} className="animate-spin" /> : "Fetch"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Skeleton rows ────────────────────────────────────────────────────────────
function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="grid grid-cols-[auto_2fr_1.2fr_1fr_1fr_1fr_1fr] gap-0 border-t border-gray-800 animate-pulse">
          <div className="pl-4 pr-1 py-3"><div className="h-4 w-4 bg-gray-700 rounded" /></div>
          <div className="px-4 py-3"><div className="h-4 bg-gray-700 rounded w-24" /></div>
          <div className="px-4 py-3"><div className="h-4 bg-gray-700 rounded w-20" /></div>
          <div className="px-4 py-3 flex justify-end"><div className="h-4 bg-gray-700 rounded w-16" /></div>
          <div className="px-4 py-3 flex justify-end"><div className="h-4 bg-gray-700 rounded w-16" /></div>
          <div className="px-4 py-3 flex justify-end"><div className="h-4 bg-gray-700 rounded w-12" /></div>
          <div className="px-4 py-3"><div className="h-5 bg-gray-700 rounded-full w-16" /></div>
        </div>
      ))}
    </>
  );
}

// ── Column headers ───────────────────────────────────────────────────────────
function ColHeaders({
  sortBy, sortDir, onSort, allChecked, onToggleAll,
}: {
  sortBy: SortField; sortDir: SortDir;
  onSort: (f: SortField) => void;
  allChecked: boolean;
  onToggleAll: (checked: boolean) => void;
}) {
  function Icon({ field }: { field: SortField }) {
    if (sortBy !== field) return <ChevronsUpDown size={12} className="ml-1 text-gray-600" />;
    return sortDir === "asc"
      ? <ArrowUp   size={12} className="ml-1 text-brand-500" />
      : <ArrowDown size={12} className="ml-1 text-brand-500" />;
  }
  return (
    <div className="bg-gray-800 grid grid-cols-[auto_2fr_1.2fr_1fr_1fr_1fr_1fr] text-xs text-gray-400 font-medium">
      <div className="pl-4 pr-1 py-3 flex items-center">
        <input type="checkbox" className="w-3.5 h-3.5 accent-sky-500" title="Select all shown"
          checked={allChecked} onChange={e => onToggleAll(e.target.checked)} />
      </div>
      <button onClick={() => onSort("symbol")}      className="flex items-center px-4 py-3 hover:text-white text-left">Symbol      <Icon field="symbol" /></button>
      <button onClick={() => onSort("candle_date")} className="flex items-center px-4 py-3 hover:text-white text-left">Signal Date <Icon field="candle_date" /></button>
      <div className="px-4 py-3 text-right">Entry</div>
      <div className="px-4 py-3 text-right">Stop Loss</div>
      <div className="px-4 py-3 text-right">Risk</div>
      <button onClick={() => onSort("outcome")}     className="flex items-center px-4 py-3 hover:text-white">Outcome     <Icon field="outcome" /></button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function AnalysisPage({ timeframe }: Props) {
  const title = timeframe === "week" ? "Weekly Signals" : "Monthly Signals";

  // Filters
  const [symbolFilter,  setSymbolFilter]  = useState("");
  const [fromDate,      setFromDate]      = useState("");
  const [toDate,        setToDate]        = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [analysisType,  setAnalysisType]  = useState("3candle_reversal");
  const [types,         setTypes]         = useState<string[]>([]);

  // Sorting (monthly only)
  const [sortBy,  setSortBy]  = useState<SortField>("candle_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Pagination (monthly only)
  const [page,     setPage]     = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [total,    setTotal]    = useState(0);

  // Weekly calendar data
  const [weekBuckets,  setWeekBuckets]  = useState<WeekBucket[]>([]);
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set());

  // Monthly data
  const [groups,  setGroups]  = useState<{ label: string; items: ScanResultFull[] }[]>([]);

  const [loading, setLoading] = useState(true);

  // Modal state
  const [modalItem,   setModalItem]   = useState<ScanResultFull | null>(null);
  const [modalDetail, setModalDetail] = useState<ScanDetail | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  // Fetch outcome
  const [fetchingId, setFetchingId] = useState<number | null>(null);

  // EOW scan
  const [eowRunning, setEowRunning] = useState(false);
  const [eowMsg,     setEowMsg]     = useState("");

  // Filter popup
  const [showFilters, setShowFilters] = useState(false);
  const activeFilterCount = [symbolFilter, fromDate, toDate, outcomeFilter].filter(Boolean).length;

  // Sync history popup
  const [showHistory, setShowHistory] = useState(false);

  // Telegram selection
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (!showFilters) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setShowFilters(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showFilters]);

  function resetFilters() {
    setSymbolFilter(""); setFromDate(""); setToDate(""); setOutcomeFilter("");
  }

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadWeekly = useCallback(async () => {
    setLoading(true);
    try {
      const buckets = await getWeekCalendar({
        analysis_type: analysisType,
        from_date: fromDate || undefined,
        to_date:   toDate   || undefined,
        weeks: 52,
      });
      // Apply outcome + symbol filters client-side on existing signals
      const filtered = buckets.map(b => ({
        ...b,
        signals: b.signals.filter(s => {
          if (outcomeFilter && s.outcome !== outcomeFilter) return false;
          if (symbolFilter  && !s.symbol.toLowerCase().includes(symbolFilter.toLowerCase())) return false;
          return true;
        }),
      }));
      // Sort newest first, drop weeks with no matches
      setWeekBuckets([...filtered].reverse().filter(b => b.signals.length > 0));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [analysisType, fromDate, toDate, outcomeFilter, symbolFilter]);

  const loadMonthly = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getScansV2({
        timeframe: "month",
        analysis_type: analysisType,
        matched_only: true,
        outcome:       outcomeFilter || undefined,
        symbol_filter: symbolFilter  || undefined,
        from_date:     fromDate      || undefined,
        to_date:       toDate        || undefined,
        sort_by:  sortBy,
        sort_dir: sortDir,
        limit:  pageSize,
        offset: page * pageSize,
      });
      setTotal(res.total);
      setGroups(groupByMonth(res.data));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [analysisType, outcomeFilter, symbolFilter, fromDate, toDate, sortBy, sortDir, page, pageSize]);

  const load = timeframe === "week" ? loadWeekly : loadMonthly;

  useEffect(() => { getAnalysisTypes().then(setTypes).catch(console.error); }, []);
  useEffect(() => { load(); }, [load]);

  // Reset page on filter change (monthly)
  const prevFilters = useRef({ symbolFilter, fromDate, toDate, outcomeFilter, analysisType, sortBy, sortDir, pageSize });
  useEffect(() => {
    const p = prevFilters.current;
    if (timeframe === "month" && (
      p.symbolFilter !== symbolFilter || p.fromDate !== fromDate || p.toDate !== toDate ||
      p.outcomeFilter !== outcomeFilter || p.analysisType !== analysisType ||
      p.sortBy !== sortBy || p.sortDir !== sortDir || p.pageSize !== pageSize
    )) {
      setPage(0);
    }
    prevFilters.current = { symbolFilter, fromDate, toDate, outcomeFilter, analysisType, sortBy, sortDir, pageSize };
  }, [timeframe, symbolFilter, fromDate, toDate, outcomeFilter, analysisType, sortBy, sortDir, pageSize]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleOpenModal(item: ScanResultFull) {
    setModalItem(item);
    setModalDetail(null);
    setModalLoading(true);
    try {
      const d = await getScanDetail(item.id);
      setModalDetail(d);
    } catch (e) { console.error(e); }
    finally { setModalLoading(false); }
  }

  async function handleFetchOutcome(item: ScanResultFull, e: React.MouseEvent) {
    e.stopPropagation();
    setFetchingId(item.id);
    try {
      await fetchOutcome(item.id);
      toast.success("Outcome fetched");
      await load();
    } catch (err) {
      toast.error("Failed to fetch outcome");
      console.error(err);
    } finally { setFetchingId(null); }
  }

  function toggleSort(field: SortField) {
    if (sortBy === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortDir("desc"); }
  }

  async function handleEowScan() {
    setEowRunning(true);
    setEowMsg("Starting EOW scan...");
    const toastId = toast.loading("EOW scan starting…");
    try {
      await triggerEowScan();
      setEowMsg("Scan started — checking status...");
      toast.loading("Scanning current week…", { id: toastId });
      for (let i = 0; i < 24; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const st = await getEowStatus();
        setEowMsg(st.message ?? "");
        if (st.status === "success") {
          toast.success("EOW scan complete", { id: toastId, description: st.message ?? undefined });
          await load();
          break;
        }
        if (st.status === "error") {
          toast.error("EOW scan failed", { id: toastId, description: st.message ?? undefined });
          break;
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "EOW scan failed";
      setEowMsg(msg);
      toast.error(msg, { id: toastId });
    } finally { setEowRunning(false); }
  }

  const totalPages = Math.ceil(total / pageSize);

  // All signals currently rendered (weekly buckets or monthly groups).
  const visibleItems: ScanResultFull[] = timeframe === "week"
    ? weekBuckets.flatMap(b => b.signals)
    : groups.flatMap(g => g.items);
  const allChecked = visibleItems.length > 0 && visibleItems.every(s => selected.has(s.id));

  function toggleAll(checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) visibleItems.forEach(s => next.add(s.id));
      else visibleItems.forEach(s => next.delete(s.id));
      return next;
    });
  }

  async function sendSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setSending(true);
    setSendMsg(null);
    const label = timeframe === "week" ? "📊 Weekly Analysis" : "📊 Monthly Analysis";
    try {
      await sendToTelegram("scans", ids, label);
      setSendMsg(`Sent ${ids.length} signal(s) to Telegram`);
      setSelected(new Set());
      toast.success(`Sent ${ids.length} signal(s) to Telegram`);
      setTimeout(() => setSendMsg(null), 3000);
    } catch (e: unknown) {
      const m = (e instanceof Error ? e.message : "Send failed").replace(/^API \d+:\s*/, "");
      setSendMsg(`Error: ${m}`);
      toast.error(m);
    } finally { setSending(false); }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Modal */}
      {modalItem && (
        <div>
          {modalLoading ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center"
                 style={{ background: "rgba(0,0,0,0.7)" }}>
              <div className="flex flex-col items-center gap-3 text-white">
                <Spinner size={32} className="text-brand-400" />
                <span className="text-sm text-gray-300">Loading chart…</span>
              </div>
            </div>
          ) : modalDetail ? (
            <OutcomeModal item={modalItem} detail={modalDetail} onClose={() => { setModalItem(null); setModalDetail(null); }} />
          ) : null}
        </div>
      )}

      {/* Sync history modal */}
      {showHistory && (
        <SyncHistoryModal
          timeframe={timeframe}
          onClose={() => setShowHistory(false)}
          onRetrigger={load}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        <div className="flex items-center gap-3">
          {/* Send to Telegram */}
          {selected.size > 0 && (
            <button
              onClick={sendSelected}
              disabled={sending}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-sky-600 hover:bg-sky-500 text-white transition disabled:opacity-50"
              title="Send selected signals to Telegram"
            >
              {sending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
              Send {selected.size} to Telegram
            </button>
          )}

          {/* Sync history button */}
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-gray-700 text-gray-400 bg-gray-900 hover:bg-gray-800 hover:text-white transition"
            title="Sync history"
          >
            <History size={14} />
            History
          </button>

          {/* Filter toggle button */}
          <button
            onClick={() => setShowFilters(true)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition ${
              activeFilterCount > 0
                ? "border-brand-500 text-brand-400 bg-brand-600/10 hover:bg-brand-600/20"
                : "border-gray-700 text-gray-400 bg-gray-900 hover:bg-gray-800 hover:text-white"
            }`}
          >
            <Filter size={14} />
            Filters
            {activeFilterCount > 0 && (
              <span className="bg-brand-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>

          {timeframe === "week" && (
            <button
              onClick={handleEowScan}
              disabled={eowRunning}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white
                         text-sm font-medium rounded-lg transition disabled:opacity-60"
            >
              {eowRunning
                ? <RefreshCw size={14} className="animate-spin" />
                : <Zap size={14} />}
              {eowRunning ? "Scanning..." : "Fetch Current Week"}
            </button>
          )}
          <SyncStatus timeframe={timeframe} onSyncComplete={load} />
        </div>
      </div>

      {/* EOW status message */}
      {timeframe === "week" && eowMsg && (
        <div className="text-sm text-gray-400 bg-gray-900 border border-gray-800 rounded-lg px-4 py-2">
          {eowMsg}
        </div>
      )}

      {/* Filter popup */}
      {showFilters && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setShowFilters(false)}
        >
          <div
            className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Popup header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <Filter size={14} className="text-brand-400" />
                <h3 className="text-sm font-semibold text-white">Filter Signals</h3>
              </div>
              <button onClick={() => setShowFilters(false)} className="text-gray-500 hover:text-white transition">
                <X size={16} />
              </button>
            </div>

            {/* Popup body */}
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Symbol</label>
                <input
                  value={symbolFilter} onChange={e => setSymbolFilter(e.target.value)}
                  placeholder="e.g. SBIN"
                  autoFocus
                  className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-brand-500 transition"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">From Date</label>
                  <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                    className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-brand-500 transition" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">To Date</label>
                  <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                    className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-brand-500 transition" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Outcome</label>
                  <select value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)}
                    className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-brand-500 transition">
                    <option value="">All outcomes</option>
                    <option value="success">Success</option>
                    <option value="failure">Failure</option>
                    <option value="pending">Pending</option>
                    <option value="open">Open</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Pattern</label>
                  <select value={analysisType} onChange={e => setAnalysisType(e.target.value)}
                    className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-brand-500 transition">
                    {types.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Popup footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-gray-800">
              <button
                onClick={() => { resetFilters(); }}
                className="text-xs text-gray-400 hover:text-white transition"
              >
                Reset all
              </button>
              <button
                onClick={() => setShowFilters(false)}
                className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── WEEKLY: week-calendar view ─────────────────────────────────────── */}
      {timeframe === "week" && (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <ColHeaders sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} allChecked={allChecked} onToggleAll={toggleAll} />

          {loading ? (
            <SkeletonRows />
          ) : weekBuckets.length === 0 ? (
            <div className="text-center py-16 text-gray-500">No data in range.</div>
          ) : (
            weekBuckets.map(bucket => {
              const weekKey     = bucket.week_start;
              const isCollapsed = collapsedWeeks.has(weekKey);
              const count       = bucket.signals.length;
              const isEmpty     = count === 0;

              return (
                <div key={weekKey}>
                  {/* Week header */}
                  <button
                    onClick={() => {
                      if (isEmpty) return;
                      setCollapsedWeeks(prev => {
                        const next = new Set(prev);
                        if (next.has(weekKey)) next.delete(weekKey); else next.add(weekKey);
                        return next;
                      });
                    }}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-xs font-semibold
                      uppercase tracking-wider border-t border-gray-800 transition
                      ${isEmpty
                        ? "bg-gray-950 text-gray-600 cursor-default"
                        : "bg-gray-900/80 text-gray-300 hover:bg-gray-900"}`}
                  >
                    {!isEmpty && (isCollapsed
                      ? <ChevronDown size={12} />
                      : <ChevronUp   size={12} />)}
                    {isEmpty && <span className="w-3" />}
                    <span>{fmtWeekLabel(bucket.week_start, bucket.week_end)}</span>
                    {isEmpty ? (
                      <span className="ml-2 text-gray-700 normal-case font-normal tracking-normal">— no match</span>
                    ) : (
                      <span className="ml-1 text-gray-500 font-normal normal-case tracking-normal">
                        ({count} match{count !== 1 ? "es" : ""})
                      </span>
                    )}
                    {/* Outcome pills summary */}
                    {!isEmpty && (
                      <div className="ml-auto flex gap-1">
                        {(["success","failure","pending","open"] as const).map(o => {
                          const n = bucket.signals.filter(s => s.outcome === o).length;
                          if (!n) return null;
                          const cls = o === "success" ? "bg-green-900/40 text-green-400" :
                                      o === "failure" ? "bg-red-900/40 text-red-400" :
                                      o === "pending" ? "bg-yellow-900/40 text-yellow-400" :
                                                        "bg-gray-800 text-gray-400";
                          return (
                            <span key={o} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cls}`}>
                              {n} {o}
                            </span>
                          );
                        })}
                        {bucket.signals.some(s => !s.outcome) && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-gray-800 text-gray-500">
                            {bucket.signals.filter(s => !s.outcome).length} —
                          </span>
                        )}
                      </div>
                    )}
                  </button>

                  {!isCollapsed && bucket.signals.map(item => (
                    <SignalRow
                      key={item.id}
                      item={item}
                      onOpen={handleOpenModal}
                      onFetch={handleFetchOutcome}
                      fetchingId={fetchingId}
                      selected={selected.has(item.id)}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── MONTHLY: month-grouped view with pagination ───────────────────── */}
      {timeframe === "month" && (
        <>
          {/* Results summary */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400 flex items-center gap-2">
              {loading ? <><Spinner size={14} className="text-gray-500" /><span>Loading…</span></> : `${total} result${total !== 1 ? "s" : ""}`}
              {total > 0 && ` — page ${page + 1} of ${totalPages}`}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Per page:</span>
              {PAGE_SIZES.map(s => (
                <button key={s} onClick={() => setPageSize(s)}
                  className={`text-xs px-2 py-1 rounded ${pageSize === s ? "bg-brand-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <ColHeaders sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} allChecked={allChecked} onToggleAll={toggleAll} />

            {loading ? (
              <SkeletonRows />
            ) : groups.length === 0 ? (
              <div className="text-center py-16 text-gray-500">No signals match the current filters.</div>
            ) : (
              groups.map(group => {
                const isCollapsed = collapsedWeeks.has(group.label);
                return (
                  <div key={group.label}>
                    <button
                      onClick={() => setCollapsedWeeks(prev => {
                        const next = new Set(prev);
                        if (next.has(group.label)) next.delete(group.label); else next.add(group.label);
                        return next;
                      })}
                      className="w-full flex items-center gap-2 px-4 py-2 bg-gray-900/80 text-xs text-gray-400
                                 font-semibold uppercase tracking-wider hover:bg-gray-900 transition border-t border-gray-800"
                    >
                      {isCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                      {group.label}
                      <span className="ml-1 text-gray-600">({group.items.length})</span>
                    </button>
                    {!isCollapsed && group.items.map(item => (
                      <SignalRow
                        key={item.id}
                        item={item}
                        onOpen={handleOpenModal}
                        onFetch={handleFetchOutcome}
                        fetchingId={fetchingId}
                        selected={selected.has(item.id)}
                        onToggleSelect={toggleSelect}
                      />
                    ))}
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setPage(0)} disabled={page === 0}
                className="p-1.5 rounded bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition">
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="px-3 py-1.5 rounded bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 text-sm transition">
                Prev
              </button>
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                const p = Math.min(Math.max(page - 3, 0) + i, totalPages - 1);
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded text-sm transition ${p === page ? "bg-brand-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
                    {p + 1}
                  </button>
                );
              })}
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                className="px-3 py-1.5 rounded bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 text-sm transition">
                Next
              </button>
              <button onClick={() => setPage(totalPages - 1)} disabled={page === totalPages - 1}
                className="p-1.5 rounded bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition">
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
