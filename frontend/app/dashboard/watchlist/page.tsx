"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Pencil, Trash2, RefreshCw, ChevronDown } from "lucide-react";
import LiveChartPane, { PaneConfig } from "@/components/LiveChartPane";
import { LiveSource, getSources, searchSymbols, SymbolMatch } from "@/lib/liveSources";
import {
  Watchlist, WatchItem,
  getWatchlists, createWatchlist, renameWatchlist, deleteWatchlist,
  getItems, addItem, deleteItem,
} from "@/lib/watchlistApi";
import { getFoUnderlyings, getExpiries } from "@/lib/tradesApi";

const LS_ACTIVE = "watchlist:activeId";
const LS_LEFT = "watchlist:leftPct";
const LS_PANE = "watchlist:pane";
const QUOTE_REFRESH_MS = 15_000;

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}
function chgColor(n: number | null | undefined) {
  if (n == null || n === 0) return "text-gray-400";
  return n > 0 ? "text-green-400" : "text-red-400";
}

export default function WatchlistPage() {
  const [sources, setSources] = useState<LiveSource[] | null>(null);
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [items, setItems] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [pane, setPane] = useState<PaneConfig>(() => {
    if (typeof window !== "undefined") {
      try { const p = JSON.parse(window.localStorage.getItem(LS_PANE) || "null"); if (p?.timeframe) return { source: "fyers", symbol: "NSE:NIFTY50-INDEX", timeframe: p.timeframe, indicators: p.indicators ?? ["volume"] }; } catch {}
    }
    return { source: "fyers", symbol: "NSE:NIFTY50-INDEX", timeframe: "1d", indicators: ["volume"] };
  });

  const [leftPct, setLeftPct] = useState<number>(25);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // add-symbol UI
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<SymbolMatch[]>([]);
  const [adding, setAdding] = useState(false);
  const [futMode, setFutMode] = useState(false);
  const [foUnderlyings, setFoUnderlyings] = useState<string[]>([]);
  const [futUnd, setFutUnd] = useState("");
  const [futExpiries, setFutExpiries] = useState<string[]>([]);
  const [futExpiry, setFutExpiry] = useState("");

  // create/rename list UI
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const fyersSources = useMemo(() => (sources ?? []).filter(s => s.name === "fyers"), [sources]);
  const activeList = lists.find(l => l.id === activeId) || null;

  // ---- bootstrap ----
  useEffect(() => {
    getSources().then(setSources).catch(() => setSources([]));
    if (typeof window !== "undefined") {
      const lp = parseFloat(window.localStorage.getItem(LS_LEFT) || "");
      if (!Number.isNaN(lp)) setLeftPct(Math.max(18, Math.min(50, lp)));
    }
    getFoUnderlyings().then(setFoUnderlyings).catch(() => {});
    (async () => {
      try {
        const wls = await getWatchlists();
        setLists(wls);
        const stored = typeof window !== "undefined" ? parseInt(window.localStorage.getItem(LS_ACTIVE) || "", 10) : NaN;
        const pick = wls.find(w => w.id === stored) ?? wls[0];
        setActiveId(pick ? pick.id : null);
        if (!pick) setLoading(false);
      } catch { setLoading(false); }
    })();
  }, []);

  const reloadLists = useCallback(async () => { try { setLists(await getWatchlists()); } catch {} }, []);

  const loadItems = useCallback(async (silent = false) => {
    if (activeId == null) { setItems([]); setLoading(false); return; }
    if (!silent) setLoading(true);
    try {
      const its = await getItems(activeId);
      setItems(its);
      // keep the chart on a valid symbol
      setPane(p => (its.some(i => i.symbol === p.symbol) || its.length === 0 ? p : { ...p, symbol: its[0].symbol }));
    } catch (e: any) {
      setMsg("Error: " + (e?.message || "failed").replace(/^API \d+:\s*/, ""));
    } finally { if (!silent) setLoading(false); }
  }, [activeId]);

  useEffect(() => {
    if (activeId != null && typeof window !== "undefined") window.localStorage.setItem(LS_ACTIVE, String(activeId));
    loadItems();
  }, [activeId, loadItems]);

  // live quote refresh while the page is open
  useEffect(() => {
    if (activeId == null) return;
    const id = window.setInterval(() => loadItems(true), QUOTE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [activeId, loadItems]);

  // persist pane tf/indicators
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_PANE, JSON.stringify({ timeframe: pane.timeframe, indicators: pane.indicators }));
  }, [pane.timeframe, pane.indicators]);

  // divider drag
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = Math.max(18, Math.min(50, ((e.clientX - rect.left) / rect.width) * 100));
      setLeftPct(pct);
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = "";
      if (typeof window !== "undefined") window.localStorage.setItem(LS_LEFT, String(leftPct));
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [leftPct]);

  // symbol search for add box
  useEffect(() => {
    if (futMode) return;
    let cancelled = false;
    const h = window.setTimeout(async () => {
      try { const r = await searchSymbols("fyers", draft, 30); if (!cancelled) setSuggestions(r); } catch {}
    }, 200);
    return () => { cancelled = true; window.clearTimeout(h); };
  }, [draft, futMode]);

  // expiries for future helper
  useEffect(() => {
    if (!futMode || !futUnd) { setFutExpiries([]); setFutExpiry(""); return; }
    let alive = true;
    getExpiries(futUnd).then(r => { if (!alive) return; setFutExpiries(r.monthly); setFutExpiry(r.monthly[0] ?? ""); }).catch(() => {});
    return () => { alive = false; };
  }, [futMode, futUnd]);

  async function onAdd() {
    if (activeId == null) return;
    setAdding(true); setMsg(null);
    try {
      let created: WatchItem;
      if (futMode) {
        if (!futUnd || !futExpiry) throw new Error("Pick an underlying and expiry");
        created = await addItem(activeId, { underlying: futUnd, expiry: futExpiry });
      } else {
        if (!draft.trim()) throw new Error("Type a symbol");
        created = await addItem(activeId, { symbol: draft.trim() });
      }
      setDraft(""); setFutUnd(""); setFutExpiry("");
      await loadItems(true);
      await reloadLists();
      setPane(p => ({ ...p, symbol: created.symbol }));
    } catch (e: any) {
      setMsg((e?.message || "Couldn't add").replace(/^API \d+:\s*/, ""));
    } finally { setAdding(false); }
  }

  async function onRemove(it: WatchItem) {
    if (activeId == null) return;
    await deleteItem(activeId, it.id).catch(() => {});
    await loadItems(true); await reloadLists();
  }

  async function onNewList() {
    const name = prompt("New watchlist name:")?.trim();
    if (!name) return;
    try { const wl = await createWatchlist(name); await reloadLists(); setActiveId(wl.id); }
    catch (e: any) { setMsg((e?.message || "failed").replace(/^API \d+:\s*/, "")); }
  }
  async function onRename() {
    if (!activeList || !nameDraft.trim()) { setEditingName(false); return; }
    try { await renameWatchlist(activeList.id, nameDraft.trim()); await reloadLists(); } catch {}
    setEditingName(false);
  }
  async function onDeleteList() {
    if (!activeList) return;
    if (!confirm(`Delete watchlist "${activeList.name}" and its symbols?`)) return;
    try {
      await deleteWatchlist(activeList.id);
      const rest = lists.filter(l => l.id !== activeList.id);
      setLists(rest);
      setActiveId(rest[0]?.id ?? null);
      if (rest.length === 0) setItems([]);
    } catch {}
  }

  return (
    <div ref={containerRef} className="flex h-full min-h-0 -m-6">
      {/* LEFT — watchlist */}
      <div className="flex flex-col min-h-0 border-r border-gray-800 bg-gray-900" style={{ width: `${leftPct}%` }}>
        {/* List selector row */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-800">
          {editingName ? (
            <input autoFocus value={nameDraft} onChange={e => setNameDraft(e.target.value)}
              onBlur={onRename} onKeyDown={e => { if (e.key === "Enter") onRename(); if (e.key === "Escape") setEditingName(false); }}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
          ) : (
            <div className="relative flex-1">
              <select
                value={activeId ?? ""}
                onChange={e => setActiveId(parseInt(e.target.value, 10))}
                className="w-full appearance-none bg-gray-800 border border-gray-700 rounded pl-2 pr-7 py-1 text-sm text-white font-medium"
              >
                {lists.length === 0 && <option value="">No lists</option>}
                {lists.map(l => <option key={l.id} value={l.id}>{l.name} ({l.item_count})</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            </div>
          )}
          <button onClick={onNewList} title="New watchlist" className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800"><Plus size={15} /></button>
          {activeList && <button onClick={() => { setNameDraft(activeList.name); setEditingName(true); }} title="Rename" className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800"><Pencil size={13} /></button>}
          {activeList && <button onClick={onDeleteList} title="Delete watchlist" className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-800"><Trash2 size={13} /></button>}
        </div>

        {/* Add symbol */}
        <div className="px-3 py-2 border-b border-gray-800 space-y-1.5">
          <div className="flex gap-1">
            <button onClick={() => setFutMode(false)} className={`px-2 py-0.5 rounded text-[11px] border ${!futMode ? "bg-brand-600 border-brand-500 text-white" : "bg-gray-800 border-gray-700 text-gray-400"}`}>Symbol</button>
            <button onClick={() => setFutMode(true)} className={`px-2 py-0.5 rounded text-[11px] border ${futMode ? "bg-brand-600 border-brand-500 text-white" : "bg-gray-800 border-gray-700 text-gray-400"}`}>Future</button>
          </div>
          {!futMode ? (
            <div className="flex gap-1">
              <input list="wl-sym-dl" value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") onAdd(); }}
                placeholder="RELIANCE, NIFTY, NSE:SRF26AUGFUT…"
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100" />
              <datalist id="wl-sym-dl">{suggestions.map(s => <option key={s.symbol} value={s.symbol}>{s.label}</option>)}</datalist>
              <button onClick={onAdd} disabled={adding} className="px-2 py-1 rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs">Add</button>
            </div>
          ) : (
            <div className="flex gap-1">
              <input list="wl-fut-und" value={futUnd} onChange={e => setFutUnd(e.target.value.toUpperCase())}
                placeholder="underlying e.g. SRF" className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100" />
              <datalist id="wl-fut-und">{foUnderlyings.map(u => <option key={u} value={u} />)}</datalist>
              <select value={futExpiry} onChange={e => setFutExpiry(e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded px-1 py-1 text-xs text-gray-100">
                <option value="">expiry</option>
                {futExpiries.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <button onClick={onAdd} disabled={adding || !futUnd || !futExpiry} className="px-2 py-1 rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs">Add</button>
            </div>
          )}
          {msg && <div className="text-[11px] text-red-300">{msg}</div>}
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="text-center text-gray-500 text-xs py-6">Loading…</div>}
          {!loading && items.length === 0 && <div className="text-center text-gray-500 text-xs py-6">{activeList ? "No symbols — add one above." : "Create a watchlist to start."}</div>}
          {items.map(it => {
            const selected = pane.symbol === it.symbol;
            return (
              <div key={it.id} onClick={() => setPane(p => ({ ...p, symbol: it.symbol }))}
                className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer border-l-2 ${selected ? "bg-brand-600/10 border-brand-500" : "border-transparent hover:bg-gray-800/60"}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-gray-100 truncate">{it.label || it.symbol.split(":").pop()}</div>
                  <div className="text-[10px] text-gray-500 truncate">{it.symbol}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-mono text-gray-200">{fmt(it.lp)}</div>
                  <div className={`text-[10px] font-mono ${chgColor(it.chp)}`}>{it.chp != null ? `${it.chp > 0 ? "+" : ""}${fmt(it.chp)}%` : "—"}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); onRemove(it); }} title="Remove"
                  className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 shrink-0"><X size={13} /></button>
              </div>
            );
          })}
        </div>
        <div className="px-3 py-1.5 border-t border-gray-800 text-[10px] text-gray-500 flex items-center gap-1">
          <RefreshCw size={10} /> live · every 15s
        </div>
      </div>

      {/* DIVIDER */}
      <div onMouseDown={e => { e.preventDefault(); draggingRef.current = true; document.body.style.userSelect = "none"; }}
        className="w-1.5 shrink-0 cursor-col-resize bg-gray-800 hover:bg-brand-500/60 transition-colors" title="Drag to resize" />

      {/* RIGHT — chart */}
      <div className="flex-1 min-h-0 p-2">
        {fyersSources.length > 0
          ? <LiveChartPane config={pane} sources={fyersSources} onChange={setPane} />
          : <div className="flex items-center justify-center h-full text-gray-500 text-sm">Loading chart…</div>}
      </div>
    </div>
  );
}
