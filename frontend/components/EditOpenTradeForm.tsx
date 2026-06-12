"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { patchTrade, Trade } from "@/lib/tradesApi";
import { fmtIsoDate, fmtIsoDateTime, isoToLocalInput, localDatetimeToIso } from "@/lib/dates";

interface Props {
  trade: Trade;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditOpenTradeForm({ trade, onClose, onSaved }: Props) {
  const [entryPrice, setEntryPrice] = useState<string>(String(trade.entry_price ?? ""));
  const [numLots, setNumLots] = useState<string>(String(trade.num_lots ?? 1));
  const [lotSize, setLotSize] = useState<string>(String(trade.lot_size ?? 1));
  const [entryAt, setEntryAt] = useState<string>(isoToLocalInput(trade.entry_at));
  const entryAtRef = useRef<HTMLInputElement>(null);
  const [currentPrice, setCurrentPrice] = useState<string>(trade.current_price != null ? String(trade.current_price) : "");
  const [notes, setNotes] = useState<string>(trade.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    setErr(null);
    setSubmitting(true);
    try {
      const body: Record<string, any> = {};
      const ep = parseFloat(entryPrice); if (!Number.isNaN(ep) && ep !== trade.entry_price) body.entry_price = ep;
      const nl = parseInt(numLots, 10);    if (!Number.isNaN(nl) && nl !== trade.num_lots) body.num_lots = nl;
      const ls = parseInt(lotSize, 10);    if (!Number.isNaN(ls) && ls !== trade.lot_size) body.lot_size = ls;
      const liveEntry = entryAtRef.current?.value || entryAt;
      const iso = localDatetimeToIso(liveEntry);
      if (iso && iso !== trade.entry_at) body.entry_at = iso;
      if (currentPrice) {
        const cp = parseFloat(currentPrice);
        if (!Number.isNaN(cp) && cp !== trade.current_price) body.current_price = cp;
      }
      if (notes !== (trade.notes ?? "")) body.notes = notes;

      if (Object.keys(body).length === 0) { onClose(); return; }
      await patchTrade(trade.id, body);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-lg shadow-2xl text-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">Edit open trade</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={16} /></button>
        </div>

        <div className="p-4 space-y-3 max-h-[80vh] overflow-y-auto">
          {/* Read-only summary */}
          <div className="rounded border border-gray-800 bg-gray-950 p-2 text-[11px] space-y-0.5">
            <div className="text-gray-100 font-mono">{trade.symbol}</div>
            <div className="text-gray-400">
              {trade.instrument_type} · <span className={trade.side === "buy" ? "text-green-400" : "text-red-400"}>{trade.side}</span>
              {trade.option_type && ` · ${trade.option_type} ${trade.strike}`}
              {trade.expiry_date && ` · expires ${fmtIsoDate(trade.expiry_date)}`}
            </div>
          </div>

          {/* Editable fields */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Entry price</label>
            <input
              type="number" step="any" value={entryPrice}
              onChange={e => setEntryPrice(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Lots</label>
              <input
                type="number" min={1} value={numLots}
                onChange={e => setNumLots(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Lot size</label>
              <input
                type="number" min={1} value={lotSize}
                onChange={e => setLotSize(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
              />
            </div>
          </div>

          <div className="text-[11px] text-gray-500">
            Total quantity: <span className="text-gray-200 font-mono">
              {((parseInt(numLots || "1", 10) || 1) * (parseInt(lotSize || "1", 10) || 1)).toLocaleString()}
            </span>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Entry date & time (local)</label>
            <input
              ref={entryAtRef}
              type="datetime-local"
              value={entryAt}
              onChange={e => setEntryAt(e.target.value)}
              onBlur={e => setEntryAt(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
            />
            <div className="text-[10px] text-green-400 mt-1">
              Will save as: {entryAt ? fmtIsoDateTime(localDatetimeToIso(entryAt)) : "—"}
            </div>
          </div>

          {trade.instrument_type === "option" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Current premium <span className="text-gray-500">(manual — yfinance can't price Indian options)</span>
              </label>
              <input
                type="number" step="any" value={currentPrice}
                onChange={e => setCurrentPrice(e.target.value)}
                placeholder="latest mark"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">Notes</label>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
            />
          </div>

          {err && <div className="text-xs text-red-400">{err}</div>}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-800 bg-gray-900/50">
          <button onClick={onClose} className="px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:text-white text-xs">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-500 text-white text-xs disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
