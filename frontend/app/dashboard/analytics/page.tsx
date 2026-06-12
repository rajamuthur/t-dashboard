"use client";
import { useEffect, useMemo, useState } from "react";
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line,
} from "recharts";
import { getAllScans, ScanResultFull } from "@/lib/api";
import Spinner from "@/components/Spinner";
import { TrendingUp, TrendingDown, Clock, Activity } from "lucide-react";

// ── Colors ───────────────────────────────────────────────────────────────────
const OC = { success: "#22c55e", failure: "#ef4444", pending: "#eab308", open: "#6b7280" };

// ── Aggregation helpers ───────────────────────────────────────────────────────
type Outcomes = { success: number; failure: number; pending: number; open: number };

function countOutcomes(items: ScanResultFull[]): Outcomes {
  const r: Outcomes = { success: 0, failure: 0, pending: 0, open: 0 };
  for (const i of items) if (i.outcome && i.outcome in r) r[i.outcome as keyof Outcomes]++;
  return r;
}

function toMonthlyBuckets(items: ScanResultFull[]) {
  const map = new Map<string, ScanResultFull[]>();
  for (const i of items) {
    if (!i.candle_date) continue;
    const k = i.candle_date.slice(0, 7);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(i);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, sigs]) => {
      const c = countOutcomes(sigs);
      const decided = c.success + c.failure;
      return {
        key: month,
        label: new Date(month + "-15").toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
        total: sigs.length,
        winRate: decided > 0 ? parseFloat(((c.success / decided) * 100).toFixed(1)) : null,
        ...c,
      };
    });
}

function topSymbols(items: ScanResultFull[], n = 10) {
  const map = new Map<string, { total: number; success: number; failure: number }>();
  for (const i of items) {
    const sym = i.symbol.replace("NSE:", "").replace("-EQ", "");
    if (!map.has(sym)) map.set(sym, { total: 0, success: 0, failure: 0 });
    const s = map.get(sym)!;
    s.total++;
    if (i.outcome === "success") s.success++;
    if (i.outcome === "failure") s.failure++;
  }
  return Array.from(map.entries())
    .map(([symbol, s]) => ({
      symbol, ...s,
      winRate: (s.success + s.failure) > 0 ? Math.round((s.success / (s.success + s.failure)) * 100) : null,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}

// ── Recharts shared styles ────────────────────────────────────────────────────
const AXIS_STYLE = { fill: "#9ca3af", fontSize: 11 };
const GRID_PROPS = { strokeDasharray: "3 3", stroke: "#1f2937" };
const TIP_STYLE  = {
  contentStyle: { background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 12 },
  labelStyle:   { color: "#d1d5db", marginBottom: 4 },
  itemStyle:    { color: "#e5e7eb" },
};

// ── Sub-components ────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, icon: Icon, iconColor, borderColor,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; iconColor: string; borderColor: string;
}) {
  return (
    <div className={`bg-gray-900 border rounded-xl p-5 flex items-center gap-4 ${borderColor}`}>
      <div className="p-3 bg-gray-800 rounded-xl">
        <Icon size={20} className={iconColor} />
      </div>
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${iconColor}`}>{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function SectionCard({ title, children, className = "" }: {
  title: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-xl p-5 ${className}`}>
      <h2 className="text-sm font-semibold text-gray-300 mb-4">{title}</h2>
      {children}
    </div>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 text-xs shadow-xl">
      {label && <p className="text-gray-400 mb-2 font-medium">{label}</p>}
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-400">{p.name}:</span>
          <span className="text-white font-mono ml-auto pl-4">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
type Tab = "all" | "week" | "month";

export default function AnalyticsPage() {
  const [weekly,  setWeekly]  = useState<ScanResultFull[]>([]);
  const [monthly, setMonthly] = useState<ScanResultFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");

  useEffect(() => {
    Promise.all([getAllScans("week"), getAllScans("month")])
      .then(([w, m]) => { setWeekly(w); setMonthly(m); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const items = useMemo(
    () => tab === "all" ? [...weekly, ...monthly] : tab === "week" ? weekly : monthly,
    [tab, weekly, monthly]
  );

  const outcomes   = useMemo(() => countOutcomes(items), [items]);
  const decided    = outcomes.success + outcomes.failure;
  const winRate    = decided > 0 ? ((outcomes.success / decided) * 100).toFixed(1) : null;
  const monthBkts  = useMemo(() => toMonthlyBuckets(items), [items]);
  const last18     = monthBkts.slice(-18);
  const symbols    = useMemo(() => topSymbols(items), [items]);

  const pieData = [
    { name: "Success", value: outcomes.success, color: OC.success },
    { name: "Failure", value: outcomes.failure, color: OC.failure },
    { name: "Pending", value: outcomes.pending, color: OC.pending },
    { name: "Open",    value: outcomes.open,    color: OC.open    },
  ].filter(d => d.value > 0);

  const winRateTrend = last18.map(b => ({
    label: b.label,
    "Win Rate %": b.winRate ?? undefined,
  }));

  // Timeframe comparison (all tab only)
  const tfCompare = useMemo(() => {
    if (tab !== "all") return [];
    const wc = countOutcomes(weekly);
    const mc = countOutcomes(monthly);
    return (["success", "failure", "pending", "open"] as const).map(o => ({
      name: o.charAt(0).toUpperCase() + o.slice(1),
      Weekly:  wc[o],
      Monthly: mc[o],
      color:   OC[o],
    }));
  }, [tab, weekly, monthly]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-96 gap-3">
      <Spinner size={36} className="text-brand-400" />
      <p className="text-sm text-gray-500">Loading analytics…</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {weekly.length} weekly · {monthly.length} monthly · {weekly.length + monthly.length} total signals
          </p>
        </div>

        {/* Timeframe tabs */}
        <div className="flex bg-gray-800 rounded-xl p-1 gap-1">
          {([["all", "All"], ["week", "Weekly"], ["month", "Monthly"]] as [Tab, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                tab === v ? "bg-brand-600 text-white shadow" : "text-gray-400 hover:text-white"
              }`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Total Signals" value={items.length}
          sub={`${weekly.length}W · ${monthly.length}M`}
          icon={Activity} iconColor="text-blue-400" borderColor="border-blue-900/40"
        />
        <StatCard
          label="Win Rate" value={winRate ? `${winRate}%` : "—"}
          sub={decided > 0 ? `${decided} decided` : "no data yet"}
          icon={TrendingUp} iconColor="text-green-400" borderColor="border-green-900/40"
        />
        <StatCard
          label="Successes" value={outcomes.success}
          sub={decided > 0 ? `${Math.round(outcomes.success / decided * 100)}% of decided` : undefined}
          icon={TrendingUp} iconColor="text-green-400" borderColor="border-green-900/40"
        />
        <StatCard
          label="Pending / Open" value={outcomes.pending + outcomes.open}
          sub={`${outcomes.pending} pending · ${outcomes.open} open`}
          icon={Clock} iconColor="text-yellow-400" borderColor="border-yellow-900/40"
        />
      </div>

      {/* ── Row 2: Donut + Monthly bar ───────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-6">
        {/* Outcome donut */}
        <SectionCard title="Outcome Distribution" className="col-span-2">
          <div className="relative">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData} cx="50%" cy="50%"
                  innerRadius={60} outerRadius={95}
                  paddingAngle={3} dataKey="value"
                  stroke="none"
                >
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            {/* Center label */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-2xl font-bold text-white">{winRate ? `${winRate}%` : "—"}</p>
                <p className="text-xs text-gray-500">win rate</p>
              </div>
            </div>
          </div>
          {/* Legend */}
          <div className="grid grid-cols-2 gap-2 mt-2">
            {pieData.map(d => (
              <div key={d.name} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                <span className="text-gray-400">{d.name}</span>
                <span className="text-white font-mono ml-auto">{d.value}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Monthly stacked bar */}
        <SectionCard title={`Monthly Signal Trend (last ${last18.length} months)`} className="col-span-3">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={last18} margin={{ top: 0, right: 0, left: -20, bottom: 0 }} barSize={14}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Bar dataKey="success" stackId="a" fill={OC.success} name="Success" />
              <Bar dataKey="failure" stackId="a" fill={OC.failure} name="Failure" />
              <Bar dataKey="pending" stackId="a" fill={OC.pending} name="Pending" />
              <Bar dataKey="open"    stackId="a" fill={OC.open}    name="Open" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      {/* ── Row 3: Win rate trend + Timeframe compare / Top symbols ─────────── */}
      <div className="grid grid-cols-5 gap-6">
        {/* Win rate trend line */}
        <SectionCard title="Monthly Win Rate (%)" className="col-span-3">
          {winRateTrend.some(d => d["Win Rate %"] != null) ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={winRateTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} />
                <YAxis domain={[0, 100]} tick={AXIS_STYLE} tickLine={false} axisLine={false} unit="%" />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#4b5563" }} />
                <Line
                  type="monotone" dataKey="Win Rate %"
                  stroke="#6366f1" strokeWidth={2}
                  dot={{ fill: "#6366f1", r: 3, strokeWidth: 0 }}
                  connectNulls={false}
                  activeDot={{ r: 5, fill: "#818cf8" }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-48 text-gray-600 text-sm">
              Not enough decided trades yet
            </div>
          )}
        </SectionCard>

        {/* Timeframe comparison (all) OR top symbols mini chart */}
        {tab === "all" ? (
          <SectionCard title="Weekly vs Monthly Breakdown" className="col-span-2">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={tfCompare} margin={{ top: 4, right: 0, left: -20, bottom: 0 }} barSize={18}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="name" tick={AXIS_STYLE} tickLine={false} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="Weekly"  fill="#6366f1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Monthly" fill="#a78bfa" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
        ) : (
          <SectionCard title="Signals by Outcome" className="col-span-2">
            <div className="space-y-3 pt-1">
              {(["success", "failure", "pending", "open"] as const).map(o => {
                const count = outcomes[o];
                const pct   = items.length > 0 ? Math.round((count / items.length) * 100) : 0;
                return (
                  <div key={o}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="capitalize text-gray-400">{o}</span>
                      <span className="text-white font-mono">{count} <span className="text-gray-600">({pct}%)</span></span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: OC[o] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}
      </div>

      {/* ── Row 4: Top symbols ───────────────────────────────────────────────── */}
      <SectionCard title={`Top ${symbols.length} Symbols by Signal Count`}>
        <div className="space-y-2">
          {symbols.length === 0 ? (
            <p className="text-sm text-gray-600 text-center py-4">No data</p>
          ) : symbols.map((s, i) => {
            const decided = s.success + s.failure;
            const successPct = decided > 0 ? Math.round((s.success / decided) * 100) : 0;
            const failurePct = decided > 0 ? Math.round((s.failure / decided) * 100) : 0;
            return (
              <div key={s.symbol} className="flex items-center gap-3 group">
                <span className="text-xs text-gray-600 w-5 text-right shrink-0">{i + 1}</span>
                <span className="text-sm text-white font-medium w-28 shrink-0">{s.symbol}</span>

                {/* Stacked bar */}
                <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden flex">
                  {decided > 0 && (
                    <>
                      <div className="h-full" style={{ width: `${successPct}%`, background: OC.success }} title={`${s.success} success`} />
                      <div className="h-full" style={{ width: `${failurePct}%`, background: OC.failure }} title={`${s.failure} failure`} />
                    </>
                  )}
                  {s.total - decided > 0 && (
                    <div className="h-full" style={{ width: `${Math.round(((s.total - decided) / s.total) * 100)}%`, background: OC.pending }} />
                  )}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-3 text-xs shrink-0">
                  <span className="text-gray-500 w-14 text-right">{s.total} signals</span>
                  {s.winRate != null ? (
                    <span className={`font-mono w-10 text-right font-semibold ${s.winRate >= 50 ? "text-green-400" : "text-red-400"}`}>
                      {s.winRate}%
                    </span>
                  ) : (
                    <span className="text-gray-600 w-10 text-right">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {symbols.length > 0 && (
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-800 text-xs text-gray-500">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: OC.success }} /> Success</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: OC.failure }} /> Failure</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: OC.pending }} /> Pending/Open</span>
            <span className="ml-auto">% = win rate of decided trades</span>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
