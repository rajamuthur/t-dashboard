"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  createTrade, getCatalog, getExpiries, getLotSize,
  InstrumentType, OptionType, Side, TradeCatalog,
} from "@/lib/tradesApi";
import { searchSymbols, SymbolMatch } from "@/lib/liveSources";
import { fmtIsoDate, fmtIsoDateTime, localDatetimeToIso } from "@/lib/dates";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export default function NewTradeForm({ onClose, onCreated }: Props) {
  const [catalog, setCatalog] = useState<TradeCatalog | null>(null);
  const [instrument, setInstrument] = useState<InstrumentType>("option");
  const [underlying, setUnderlying] = useState<string>("NIFTY");
  const [stockDraft, setStockDraft] = useState<string>("");
  const [stockMode, setStockMode] = useState<boolean>(false);
  const [stockSuggestions, setStockSuggestions] = useState<SymbolMatch[]>([]);
  const [side, setSide] = useState<Side>("buy");
  const [optionType, setOptionType] = useState<OptionType>("CE");
  const [strike, setStrike] = useState<string>("");
  const [expiry, setExpiry] = useState<string>("");
  const [expiriesList, setExpiriesList] = useState<{ weekly: string[]; monthly: string[] }>({ weekly: [], monthly: [] });
  const [lotSize, setLotSize] = useState<string>("");
  const [numLots, setNumLots] = useState<string>("1");
  const [entryPrice, setEntryPrice] = useState<string>("");
  // datetime-local format: "YYYY-MM-DDTHH:mm" in the browser's local timezone.
  const [entryAt, setEntryAt] = useState<string>(() => {
    const now = new Date();
    const off = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - off).toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const entryAtRef = useRef<HTMLInputElement>(null);

  // Load catalog once
  useEffect(() => { getCatalog().then(setCatalog).catch(() => {}); }, []);

  // Esc to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Resolve the effective underlying when in "stock" mode (use the typed/picked stock symbol).
  const effectiveUnderlying = useMemo(() => {
    if (instrument === "equity") return stockDraft.trim().toUpperCase();
    return stockMode ? stockDraft.trim().toUpperCase() : underlying;
  }, [instrument, stockMode, stockDraft, underlying]);

  // Refresh lot size on underlying / instrument change.
  useEffect(() => {
    if (!effectiveUnderlying) { setLotSize(""); return; }
    let alive = true;
    const u = effectiveUnderlying.replace(/\.NS$|\.BO$/i, "");
    getLotSize(u).then(r => {
      if (!alive) return;
      if (r.lot_size != null) setLotSize(String(r.lot_size));
      else if (instrument === "equity") setLotSize("1");
      else setLotSize("");
    }).catch(() => {});
    return () => { alive = false; };
  }, [effectiveUnderlying, instrument]);

  // Refresh expiries when underlying changes (futures/options).
  useEffect(() => {
    if (instrument === "equity" || !effectiveUnderlying) {
      setExpiriesList({ weekly: [], monthly: [] });
      setExpiry("");
      return;
    }
    let alive = true;
    const u = effectiveUnderlying.replace(/\.NS$|\.BO$/i, "");
    getExpiries(u).then(r => {
      if (!alive) return;
      setExpiriesList({ weekly: r.weekly, monthly: r.monthly });
      // Pick a sensible default: first monthly, else first weekly
      const first = r.monthly[0] ?? r.weekly[0] ?? "";
      setExpiry(prev => prev || first);
    }).catch(() => { setExpiriesList({ weekly: [], monthly: [] }); });
    return () => { alive = false; };
  }, [effectiveUnderlying, instrument]);

  // Stock search (yfinance India F&O)
  useEffect(() => {
    if (!stockMode && instrument !== "equity") return;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const rows = await searchSymbols("yfinance", stockDraft, 20);
        if (!cancelled) setStockSuggestions(rows);
      } catch { /* ignore */ }
    }, 200);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [stockDraft, stockMode, instrument]);

  async function submit() {
    setErr(null);
    setSubmitting(true);
    try {
      const u = (effectiveUnderlying || "").trim();
      if (!u) throw new Error("Pick an underlying first");
      if (!entryPrice) throw new Error("Entry price is required");
      const payload: any = {
        instrument_type: instrument,
        underlying: u,
        side,
        num_lots: Math.max(1, parseInt(numLots || "1", 10)),
        entry_price: parseFloat(entryPrice),
      };
      if (lotSize) payload.lot_size = parseInt(lotSize, 10);
      // Prefer the live DOM value over React state — guards against picker → submit
      // races where the input's onChange hasn't propagated yet.
      const liveEntry = entryAtRef.current?.value || entryAt;
      const iso = localDatetimeToIso(liveEntry);
      if (iso) payload.entry_at = iso;
      if (notes) payload.notes = notes;
      if (instrument === "option") {
        if (!strike) throw new Error("Strike is required for options");
        if (!expiry) throw new Error("Pick an expiry");
        payload.option_type = optionType;
        payload.strike = parseFloat(strike);
        payload.expiry_date = expiry;
      } else if (instrument === "future") {
        if (!expiry) throw new Error("Pick an expiry");
        payload.expiry_date = expiry;
      }
      await createTrade(payload);
      onCreated();
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Failed to save trade");
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------- render ----------------
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={rootRef} className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-lg shadow-2xl text-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">New trade</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={16} /></button>
        </div>

        <div className="p-4 space-y-3 max-h-[80vh] overflow-y-auto">
          {/* Instrument type */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Instrument</label>
            <div className="flex gap-1">
              {(["equity", "future", "option"] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setInstrument(t)}
                  className={`flex-1 py-1.5 rounded text-xs capitalize border ${
                    instrument === t
                      ? "bg-brand-600 border-brand-500 text-white"
                      : "bg-gray-800 border-gray-700 text-gray-300 hover:text-white"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Underlying picker */}
          {instrument !== "equity" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Underlying</label>
              <div className="flex flex-wrap gap-1 mb-2">
                {(catalog?.indices ?? []).map(ix => (
                  <button
                    key={ix.key}
                    type="button"
                    onClick={() => { setStockMode(false); setUnderlying(ix.key); }}
                    className={`px-2 py-1 rounded text-[11px] border ${
                      !stockMode && underlying === ix.key
                        ? "bg-brand-600 border-brand-500 text-white"
                        : "bg-gray-800 border-gray-700 text-gray-300 hover:text-white"
                    }`}
                  >
                    {ix.key}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setStockMode(true)}
                  className={`px-2 py-1 rounded text-[11px] border ${
                    stockMode
                      ? "bg-brand-600 border-brand-500 text-white"
                      : "bg-gray-800 border-gray-700 text-gray-300 hover:text-white"
                  }`}
                  title={instrument === "future" ? "Stock futures (NSE F&O)" : "Stock options (NSE F&O)"}
                >
                  Stock (F&O)
                </button>
              </div>
              {stockMode && (
                <>
                  <input
                    list="trade-stock-dl"
                    value={stockDraft}
                    onChange={e => setStockDraft(e.target.value)}
                    placeholder={instrument === "future"
                      ? "F&O stock future — e.g. RELIANCE, TCS, INFY"
                      : "F&O stock option — e.g. RELIANCE, TCS, INFY"}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
                  />
                  <datalist id="trade-stock-dl">
                    {stockSuggestions.map(s => (
                      <option key={s.symbol} value={s.symbol.replace(/\.NS$|\.BO$/i, "")}>
                        {s.label}
                      </option>
                    ))}
                  </datalist>
                  <div className="text-[10px] text-gray-500 mt-1">
                    Lot size auto-resolves from the NSE F&O catalog (e.g. RELIANCE = 500, TCS = 175). Override below if stale.
                  </div>
                </>
              )}
            </div>
          )}

          {instrument === "equity" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Symbol (e.g. RELIANCE.NS or AAPL)</label>
              <input
                list="trade-stock-dl"
                value={stockDraft}
                onChange={e => setStockDraft(e.target.value)}
                placeholder="Symbol"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
              />
              <datalist id="trade-stock-dl">
                {stockSuggestions.map(s => (
                  <option key={s.symbol} value={s.symbol}>{s.label}</option>
                ))}
              </datalist>
            </div>
          )}

          {/* Side */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Side</label>
            <div className="flex gap-1">
              {(["buy", "sell"] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  className={`flex-1 py-1.5 rounded text-xs uppercase tracking-wider border ${
                    side === s
                      ? s === "buy"
                        ? "bg-green-600 border-green-500 text-white"
                        : "bg-red-600 border-red-500 text-white"
                      : "bg-gray-800 border-gray-700 text-gray-300"
                  }`}
                >
                  {s === "buy" ? "Buy / Long" : "Sell / Short"}
                </button>
              ))}
            </div>
          </div>

          {/* Option type + strike */}
          {instrument === "option" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Option type</label>
                <div className="flex gap-1">
                  {(["CE", "PE"] as const).map(o => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOptionType(o)}
                      className={`flex-1 py-1.5 rounded text-xs border ${
                        optionType === o
                          ? "bg-brand-600 border-brand-500 text-white"
                          : "bg-gray-800 border-gray-700 text-gray-300"
                      }`}
                    >
                      {o === "CE" ? "Call (CE)" : "Put (PE)"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Strike</label>
                <input
                  type="number"
                  value={strike}
                  onChange={e => setStrike(e.target.value)}
                  placeholder="25000"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
                />
              </div>
            </div>
          )}

          {/* Expiry */}
          {instrument !== "equity" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Expiry</label>
              <select
                value={expiry}
                onChange={e => setExpiry(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
              >
                <option value="">— pick —</option>
                {expiriesList.weekly.length > 0 && (
                  <optgroup label="Weekly">
                    {expiriesList.weekly.map(d => <option key={`w-${d}`} value={d}>{fmtIsoDate(d)}</option>)}
                  </optgroup>
                )}
                <optgroup label="Monthly">
                  {expiriesList.monthly.map(d => <option key={`m-${d}`} value={d}>{fmtIsoDate(d)}</option>)}
                </optgroup>
              </select>
            </div>
          )}

          {/* Entry price + lots + lot size */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Entry price</label>
              <input
                type="number" step="any" value={entryPrice}
                onChange={e => setEntryPrice(e.target.value)}
                placeholder="0.00"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Lots / qty</label>
              <input
                type="number" min={1} value={numLots}
                onChange={e => setNumLots(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Lot size {lotSize && instrument !== "equity" && <span className="text-green-400">(auto)</span>}
              </label>
              <input
                type="number" min={1} value={lotSize}
                onChange={e => setLotSize(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Entry date & time <span className="text-gray-500">(local; defaults to now — backdate to log past trades)</span>
            </label>
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

          <div className="text-[11px] text-gray-500">
            Total quantity: <span className="text-gray-200 font-mono">
              {((parseInt(numLots || "1", 10) || 1) * (parseInt(lotSize || "1", 10) || 1)).toLocaleString()}
            </span>
            {entryPrice && (
              <> · Notional: <span className="text-gray-200 font-mono">
                {((parseInt(numLots || "1", 10) || 1) * (parseInt(lotSize || "1", 10) || 1) * (parseFloat(entryPrice) || 0))
                  .toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span></>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Notes (optional)</label>
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
            {submitting ? "Saving…" : "Save trade"}
          </button>
        </div>
      </div>
    </div>
  );
}
