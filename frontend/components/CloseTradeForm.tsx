"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { patchTrade, Trade } from "@/lib/tradesApi";
import { fmtIsoDateTime, localDatetimeToIso } from "@/lib/dates";

interface Props {
  trade: Trade;
  onClose: () => void;
  onClosed: () => void;
}

function nowLocalInput(): string {
  const now = new Date();
  const off = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - off).toISOString().slice(0, 16);
}

function fmtDuration(ms: number): string {
  if (ms < 0) return "—";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function CloseTradeForm({ trade, onClose, onClosed }: Props) {
  const [exitPrice, setExitPrice] = useState<string>(trade.current_price != null ? String(trade.current_price) : "");
  const [exitAt, setExitAt] = useState<string>(nowLocalInput());
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const exitAtRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const qty = trade.num_lots * trade.lot_size;

  const { pnlPreview, pnlPctPreview, durationStr } = useMemo(() => {
    const ex = parseFloat(exitPrice);
    let pnl: number | null = null;
    let pct: number | null = null;
    if (!Number.isNaN(ex)) {
      const delta = trade.side === "buy" ? ex - trade.entry_price : trade.entry_price - ex;
      pnl = delta * qty;
      pct = trade.entry_price ? (delta / trade.entry_price) * 100 : 0;
    }
    let dur = "—";
    if (exitAt && trade.entry_at) {
      const exitMs = new Date(exitAt).getTime();
      const entryMs = new Date(trade.entry_at).getTime();
      if (!Number.isNaN(exitMs) && !Number.isNaN(entryMs)) {
        dur = fmtDuration(exitMs - entryMs);
      }
    }
    return { pnlPreview: pnl, pnlPctPreview: pct, durationStr: dur };
  }, [exitPrice, exitAt, trade, qty]);

  async function submit() {
    setErr(null);
    if (!exitPrice) { setErr("Enter the exit price"); return; }
    const ex = parseFloat(exitPrice);
    if (Number.isNaN(ex)) { setErr("Exit price must be a number"); return; }
    setSubmitting(true);
    try {
      const body: Record<string, any> = { exit_price: ex };
      const liveExit = exitAtRef.current?.value || exitAt;
      const iso = localDatetimeToIso(liveExit);
      if (iso) body.exit_at = iso;
      await patchTrade(trade.id, body);
      onClosed();
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Failed to close trade");
    } finally {
      setSubmitting(false);
    }
  }

  const pnlColor = pnlPreview == null ? "text-gray-400" : pnlPreview >= 0 ? "text-green-400" : "text-red-400";

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-lg shadow-2xl text-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">Close trade</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={16} /></button>
        </div>

        <div className="p-4 space-y-3">
          {/* Trade summary */}
          <div className="rounded border border-gray-800 bg-gray-950 p-2 text-[11px] space-y-0.5">
            <div className="text-gray-100 font-mono">{trade.symbol}</div>
            <div className="text-gray-400">
              <span className={trade.side === "buy" ? "text-green-400" : "text-red-400"}>{trade.side.toUpperCase()}</span>
              {" "}· entry {trade.entry_price.toLocaleString()} · qty {qty.toLocaleString()} ({trade.num_lots}×{trade.lot_size})
            </div>
            <div className="text-gray-500">
              Entered: {new Date(trade.entry_at).toLocaleString()}
            </div>
          </div>

          {/* Exit price */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Exit price</label>
            <input
              type="number" step="any" autoFocus
              value={exitPrice}
              onChange={e => setExitPrice(e.target.value)}
              placeholder={trade.current_price != null ? String(trade.current_price) : "0.00"}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
            />
          </div>

          {/* Exit datetime */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Exit date & time (local)</label>
            <input
              ref={exitAtRef}
              type="datetime-local"
              value={exitAt}
              onChange={e => setExitAt(e.target.value)}
              onBlur={e => setExitAt(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
            />
            <div className="text-[10px] text-green-400 mt-1">
              Will save as: {exitAt ? fmtIsoDateTime(localDatetimeToIso(exitAt)) : "—"}
            </div>
          </div>

          {/* Live preview */}
          <div className="grid grid-cols-2 gap-2 rounded border border-gray-800 bg-gray-950 p-2 text-[11px]">
            <div>
              <div className="text-gray-500 uppercase tracking-wider text-[10px]">Duration</div>
              <div className="text-gray-200 font-mono text-sm">{durationStr}</div>
            </div>
            <div>
              <div className="text-gray-500 uppercase tracking-wider text-[10px]">P&L</div>
              <div className={`font-mono text-sm ${pnlColor}`}>
                {pnlPreview == null
                  ? "—"
                  : `${pnlPreview >= 0 ? "+" : ""}${pnlPreview.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                {pnlPctPreview != null && (
                  <span className="ml-1 text-[11px] text-gray-400">
                    ({pnlPctPreview >= 0 ? "+" : ""}{pnlPctPreview.toFixed(2)}%)
                  </span>
                )}
              </div>
            </div>
          </div>

          {err && <div className="text-xs text-red-400">{err}</div>}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-800 bg-gray-900/50">
          <button onClick={onClose} className="px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:text-white text-xs">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !exitPrice}
            className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs disabled:opacity-50"
          >
            {submitting ? "Closing…" : "Close trade"}
          </button>
        </div>
      </div>
    </div>
  );
}
