"use client";
import { useEffect, useState } from "react";
import { getHolidays, refreshHolidays } from "@/lib/api";
import { RefreshCw, CalendarDays } from "lucide-react";

interface HolidayEntry {
  date: string;
  day: string;
  month: string;
  year: string;
}

function parseHolidays(dates: string[]): Record<string, HolidayEntry[]> {
  const byYear: Record<string, HolidayEntry[]> = {};
  for (const d of dates) {
    const dt = new Date(d + "T00:00:00");
    if (isNaN(dt.getTime())) continue;
    const year  = dt.getFullYear().toString();
    const month = dt.toLocaleDateString("en-IN", { month: "long" });
    const day   = dt.toLocaleDateString("en-IN", { weekday: "long" });
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push({ date: d, day, month, year });
  }
  return byYear;
}

const MONTH_ORDER = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export default function HolidaysPage() {
  const [holidays,    setHolidays]    = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState("");
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [msg,         setMsg]         = useState("");

  useEffect(() => {
    getHolidays()
      .then(r => { setHolidays(r.holidays); setLastUpdated(r.last_updated); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleRefresh() {
    setRefreshing(true); setMsg("");
    try {
      const r = await refreshHolidays();
      setHolidays(r.holidays);
      setLastUpdated(r.last_updated);
      setMsg(`Updated: ${r.count} holidays fetched from NSE`);
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : "Failed"}`);
    } finally { setRefreshing(false); }
  }

  const byYear  = parseHolidays(holidays);
  const years   = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));
  const today   = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarDays size={22} className="text-brand-400" />
          <h1 className="text-2xl font-bold text-white">NSE Trading Holidays</h1>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-60
                     text-white text-sm px-4 py-2 rounded-lg border border-gray-700 transition"
        >
          {refreshing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {refreshing ? "Fetching…" : "Refresh from NSE"}
        </button>
      </div>

      {lastUpdated && (
        <p className="text-xs text-gray-500">
          Last updated: {new Date(lastUpdated).toLocaleString("en-IN")}
        </p>
      )}

      {msg && (
        <div className={`text-sm px-4 py-2 rounded-lg ${msg.startsWith("Error") ? "bg-red-950/40 text-red-300 border border-red-800" : "bg-green-950/40 text-green-300 border border-green-800"}`}>
          {msg}
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 py-8">Loading…</div>
      ) : holidays.length === 0 ? (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
          <p className="text-gray-400 mb-3">No holidays loaded yet.</p>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="bg-brand-600 hover:bg-brand-500 text-white text-sm px-4 py-2 rounded-lg transition"
          >
            Fetch from NSE
          </button>
        </div>
      ) : (
        years.map(year => {
          const entries = byYear[year];
          // Group by month
          const byMonth: Record<string, HolidayEntry[]> = {};
          for (const e of entries) {
            if (!byMonth[e.month]) byMonth[e.month] = [];
            byMonth[e.month].push(e);
          }
          const months = MONTH_ORDER.filter(m => byMonth[m]);

          return (
            <div key={year} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              <div className="px-5 py-3 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
                <span className="font-semibold text-white">{year}</span>
                <span className="text-xs text-gray-400">{entries.length} holiday{entries.length !== 1 ? "s" : ""}</span>
              </div>
              {months.map(month => (
                <div key={month}>
                  <div className="px-5 py-2 bg-gray-900/60 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider font-semibold">
                    {month}
                  </div>
                  {byMonth[month].map(h => {
                    const isPast   = h.date < today;
                    const isToday  = h.date === today;
                    return (
                      <div
                        key={h.date}
                        className={`flex items-center justify-between px-5 py-2.5 border-b border-gray-800/50
                          ${isToday ? "bg-brand-950/30" : isPast ? "opacity-40" : ""}`}
                      >
                        <div className="flex items-center gap-3">
                          {isToday && <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />}
                          {!isToday && <span className="w-1.5 h-1.5 rounded-full bg-gray-700" />}
                          <span className="text-sm font-mono text-gray-200">{h.date}</span>
                          <span className="text-sm text-gray-400">{h.day}</span>
                        </div>
                        {isToday && (
                          <span className="text-xs bg-brand-600/20 text-brand-400 border border-brand-700 rounded px-2 py-0.5">
                            Today
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
