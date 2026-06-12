"use client";
import { useEffect, useState, useCallback } from "react";
import { X, RefreshCw, Clock, CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp, Database } from "lucide-react";
import { toast } from "sonner";
import { getSyncLogs, getSyncCoverage, triggerSync, SyncLog, SyncCoverageRow } from "@/lib/api";

interface Props {
  timeframe: "week" | "month";
  onClose: () => void;
  onRetrigger: () => void;
}

function fmtDate(ymd: string): string {
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtRunTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }),
  };
}

function duration(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s  = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function periodLabel(row: SyncCoverageRow, timeframe: "week" | "month"): string {
  if (timeframe === "week" && row.week_start) {
    return `${fmtDate(row.week_start)} – ${fmtDate(row.period_date)}`;
  }
  // monthly — show "Month YYYY"
  const d = new Date(row.period_date + "T00:00:00");
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-green-400 bg-green-900/30 border border-green-800 px-1.5 py-0.5 rounded-full">
        <CheckCircle size={9} /> ok
      </span>
    );
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-red-400 bg-red-900/30 border border-red-800 px-1.5 py-0.5 rounded-full">
        <XCircle size={9} /> error
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-yellow-400 bg-yellow-900/30 border border-yellow-800 px-1.5 py-0.5 rounded-full">
      <Loader2 size={9} className="animate-spin" /> running
    </span>
  );
}

export default function SyncHistoryModal({ timeframe, onClose, onRetrigger }: Props) {
  const [coverage,    setCoverage]    = useState<SyncCoverageRow[]>([]);
  const [logs,        setLogs]        = useState<SyncLog[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [retriggering, setRetriggering] = useState(false);
  const [showRuns,    setShowRuns]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cov, lg] = await Promise.all([
        getSyncCoverage(timeframe),
        getSyncLogs(timeframe),
      ]);
      setCoverage(cov);
      setLogs(lg);
    } catch {
      toast.error("Failed to load sync history");
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  async function handleRetrigger() {
    setRetriggering(true);
    try {
      await triggerSync(timeframe);
      toast.success(`${timeframe === "week" ? "Weekly" : "Monthly"} sync started`);
      onRetrigger();
      onClose();
    } catch {
      toast.error("Failed to start sync");
    } finally {
      setRetriggering(false);
    }
  }

  const label = timeframe === "week" ? "Weekly" : "Monthly";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <Database size={15} className="text-brand-400" />
            <h3 className="text-sm font-semibold text-white">{label} Data Coverage</h3>
            {!loading && coverage.length > 0 && (
              <span className="text-xs text-gray-500">{coverage.length} {timeframe === "week" ? "weeks" : "months"} in DB</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="text-gray-500 hover:text-white transition p-1 rounded" title="Refresh">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-white transition">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-500 gap-2">
              <Loader2 size={18} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {/* ── Coverage table ─────────────────────────────────── */}
              {coverage.length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-sm">No candle data in database yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 bg-gray-800/60 border-b border-gray-800">
                      <th className="text-left px-5 py-3 font-medium">{timeframe === "week" ? "Week" : "Month"}</th>
                      <th className="text-right px-5 py-3 font-medium">Stocks</th>
                      <th className="px-4 py-3 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.map((row, i) => (
                      <tr key={row.period_date} className={`border-b border-gray-800/50 ${i % 2 === 0 ? "" : "bg-gray-800/20"}`}>
                        <td className="px-5 py-3 text-gray-200 text-sm font-medium">
                          {periodLabel(row, timeframe)}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-gray-300 text-sm">
                          {row.stocks_count.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={handleRetrigger}
                            disabled={retriggering}
                            className="inline-flex items-center gap-1 text-xs bg-gray-800 hover:bg-gray-700 text-white px-2.5 py-1 rounded-lg transition disabled:opacity-50"
                          >
                            {retriggering ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                            Retrigger
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* ── Sync run log (collapsible) ──────────────────────── */}
              <div className="border-t border-gray-800">
                <button
                  onClick={() => setShowRuns(v => !v)}
                  className="w-full flex items-center gap-2 px-5 py-3 text-xs text-gray-500 hover:text-gray-300 transition"
                >
                  {showRuns ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  <Clock size={11} />
                  Sync run log ({logs.length})
                </button>

                {showRuns && (
                  <table className="w-full text-xs border-t border-gray-800/50">
                    <thead>
                      <tr className="text-[11px] text-gray-600 bg-gray-800/40 border-b border-gray-800">
                        <th className="text-left px-5 py-2 font-medium">Run At (IST)</th>
                        <th className="text-center px-4 py-2 font-medium">Duration</th>
                        <th className="text-right px-4 py-2 font-medium">Rows</th>
                        <th className="text-right px-4 py-2 font-medium">Stocks</th>
                        <th className="text-left px-4 py-2 font-medium">Status</th>
                        <th className="text-left px-4 py-2 font-medium">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.length === 0 ? (
                        <tr><td colSpan={6} className="px-5 py-4 text-center text-gray-600">No run history.</td></tr>
                      ) : logs.map((log, i) => {
                        const { date, time } = fmtRunTime(log.started_at);
                        return (
                          <tr key={log.id} className={`border-b border-gray-800/40 ${i % 2 === 0 ? "" : "bg-gray-800/10"}`}>
                            <td className="px-5 py-2.5 whitespace-nowrap">
                              <div className="text-gray-300">{date}</div>
                              <div className="text-gray-600 font-mono">{time}</div>
                            </td>
                            <td className="px-4 py-2.5 text-center text-gray-500 font-mono">
                              {duration(log.started_at, log.finished_at)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-400 font-mono">
                              {log.rows_saved > 0 ? log.rows_saved.toLocaleString() : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-400 font-mono">
                              {log.stocks_scanned > 0 ? log.stocks_scanned : "—"}
                            </td>
                            <td className="px-4 py-2.5"><StatusBadge status={log.status} /></td>
                            <td className="px-4 py-2.5 text-gray-600 max-w-[180px] truncate" title={log.message ?? ""}>
                              {log.message ?? "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-800 shrink-0 flex items-center justify-between">
          <span className="text-xs text-gray-600">Retrigger runs a full sync for the current {timeframe === "week" ? "week" : "month"}</span>
          <button onClick={onClose} className="px-4 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
