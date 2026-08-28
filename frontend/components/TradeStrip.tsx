"use client";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Trade, TradeMode, SpotQuote } from "@/lib/tradesApi";
import { fmtIsoDateTime } from "@/lib/dates";

function inr(n: number | null | undefined, fixed = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: fixed });
}
function pnlColor(p: number | null | undefined) {
  if (p == null || p === 0) return "text-gray-300";
  return p > 0 ? "text-green-400" : "text-red-400";
}
function heldFor(t: Trade): string {
  if (!t.exit_at || !t.entry_at) return "—";
  const ms = new Date(t.exit_at).getTime() - new Date(t.entry_at).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><span className="text-gray-500">{label} </span>{children}</div>;
}

export default function TradeStrip({ trades, book, spotQuotes }: { trades: Trade[]; book: TradeMode; spotQuotes: Record<string, SpotQuote> }) {
  const [hover, setHover] = useState<{ t: Trade; x: number; y: number } | null>(null);

  // Every trade in this book, newest entry first (latest at the left).
  const ordered = [...trades].sort((a, b) => {
    const ta = a.entry_at ? new Date(a.entry_at).getTime() : 0;
    const tb = b.entry_at ? new Date(b.entry_at).getTime() : 0;
    return tb - ta;
  });
  if (ordered.length === 0) return null;

  const t = hover?.t;
  const sq = t ? spotQuotes[t.underlying] : undefined;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">All {book} trades ({ordered.length}) · newest first</span>
        <span className="text-[10px] text-gray-600">hover a trade for details</span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {ordered.map(tr => {
          const win = tr.net_pnl >= 0;
          return (
            <button
              key={tr.id}
              onMouseEnter={e => { const r = e.currentTarget.getBoundingClientRect(); setHover({ t: tr, x: r.left + r.width / 2, y: r.bottom }); }}
              onMouseLeave={() => setHover(null)}
              title={tr.symbol}
              className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center border transition ${
                win ? "bg-green-500/20 border-green-500/60 text-green-300 hover:bg-green-500/30"
                    : "bg-red-500/20 border-red-500/60 text-red-300 hover:bg-red-500/30"
              }`}
            >
              {win ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
            </button>
          );
        })}
      </div>

      {t && hover && (
        <div
          className="fixed z-50 w-64 -translate-x-1/2 mt-2 rounded-lg border border-gray-700 bg-gray-950 shadow-2xl p-3 text-xs pointer-events-none"
          style={{ left: hover.x, top: hover.y }}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-semibold text-white font-mono">{t.symbol}</span>
            <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${t.net_pnl >= 0 ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300"}`}>
              {t.net_pnl >= 0 ? "win" : "loss"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-gray-300">
            <Field label="Type"><span className="capitalize">{t.instrument_type}</span></Field>
            <Field label="Side"><span className={t.side === "buy" ? "text-green-400" : "text-red-400"}>{t.side}</span></Field>
            <Field label="Qty">{t.num_lots}×{t.lot_size} <span className="text-gray-500">({t.qty})</span></Field>
            <Field label="Entry">{inr(t.entry_price)}</Field>
            <Field label={t.status === "closed" ? "Exit" : "Current"}>{inr(t.status === "closed" ? t.exit_price : t.current_price)}</Field>
            <Field label="Stock">{sq?.lp != null ? <>{inr(sq.lp)} <span className={pnlColor(sq.chp)}>{sq.chp != null ? `${sq.chp > 0 ? "+" : ""}${sq.chp.toFixed(2)}%` : ""}</span></> : "—"}</Field>
            <Field label="P&L"><span className={pnlColor(t.pnl)}>{inr(t.pnl)}</span></Field>
            <Field label="%"><span className={pnlColor(t.pnl_pct)}>{t.pnl_pct != null ? t.pnl_pct.toFixed(2) + "%" : "—"}</span></Field>
            <Field label="Charges"><span className="text-amber-300/90">−{inr(t.charges)}</span></Field>
            <Field label="Net"><span className={`font-semibold ${pnlColor(t.net_pnl)}`}>{inr(t.net_pnl)}</span></Field>
            <Field label="Entered">{fmtIsoDateTime(t.entry_at)}</Field>
            <Field label={t.status === "closed" ? "Exited" : "Status"}>{t.status === "closed" ? fmtIsoDateTime(t.exit_at) : "open"}</Field>
            {t.status === "closed" && <Field label="Held">{heldFor(t)}</Field>}
          </div>
          {book === "paper" && t.rationale && (
            <div className="mt-1.5 pt-1.5 border-t border-gray-800 text-gray-400">{t.rationale}</div>
          )}
        </div>
      )}
    </div>
  );
}
