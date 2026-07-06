"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, X, CheckCircle2, Pencil, ArrowUp, ArrowDown, ArrowUpDown, Send } from "lucide-react";
import NewTradeForm from "@/components/NewTradeForm";
import EditOpenTradeForm from "@/components/EditOpenTradeForm";
import CloseTradeForm from "@/components/CloseTradeForm";
import {
  Trade, TradeDashboard, TradeMode,
  listTrades, getDashboard, refreshAll, refreshOne,
  deleteTrade, setFyersToken,
} from "@/lib/tradesApi";
import { sendToTelegram } from "@/lib/telegramApi";
import { fmtIsoDateTime } from "@/lib/dates";

type SortKey =
  | "symbol" | "instrument_type" | "side" | "qty" | "entry_price"
  | "ref_price" | "pnl" | "pnl_pct" | "entry_at" | "exit_at";
type SortDir = "asc" | "desc";

const REFRESH_INTERVAL_MS = 30_000;

function inr(n: number | null | undefined, fixed = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: fixed });
}
function pctColor(p: number | null | undefined) {
  if (p == null || p === 0) return "text-gray-300";
  return p > 0 ? "text-green-400" : "text-red-400";
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "pos" | "neg" | "neutral" }) {
  const tint = accent === "pos" ? "text-green-400" : accent === "neg" ? "text-red-400" : "text-white";
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-xl font-semibold font-mono tabular-nums mt-1 ${tint}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function TradesPage() {
  const [book, setBook] = useState<TradeMode>("actual");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [dash, setDash] = useState<TradeDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Trade | null>(null);
  const [closing, setClosing] = useState<Trade | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenMsg, setTokenMsg] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open");
  const [sortKey, setSortKey] = useState<SortKey>("entry_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
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

  async function sendSelectedToTelegram() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setSending(true);
    setSendMsg(null);
    try {
      await sendToTelegram("trades", ids, "💼 Trades & P&L");
      setSendMsg(`Sent ${ids.length} trade(s) to Telegram`);
      setSelected(new Set());
      setTimeout(() => setSendMsg(null), 3000);
    } catch (e: any) {
      const m = (e?.message || "Send failed").replace(/^API \d+:\s*/, "");
      setSendMsg(`Error: ${m}`);
    } finally { setSending(false); }
  }

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  }

  const reload = useCallback(async () => {
    try {
      const [t, d] = await Promise.all([listTrades(undefined, book), getDashboard(book)]);
      setTrades(t);
      setDash(d);
    } finally {
      setLoading(false);
    }
  }, [book]);

  useEffect(() => { reload(); }, [reload]);

  // Switching book: clear cross-book selection and show a fresh load.
  function switchBook(b: TradeMode) {
    if (b === book) return;
    setSelected(new Set());
    setLoading(true);
    setBook(b);
  }

  // Auto-refresh prices for open non-option trades every 30s, then reload data.
  useEffect(() => {
    const id = window.setInterval(async () => {
      try { await refreshAll(book); await reload(); } catch { /* silent */ }
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [reload, book]);

  async function onRefreshAll() {
    setRefreshing(true);
    try {
      const res = await refreshAll(book);
      await reload();
      if (res.note) { setTokenMsg(res.note); setShowToken(true); }
      else { setTokenMsg(`Updated ${res.refreshed} live price(s).`); setShowToken(false); }
    } finally { setRefreshing(false); }
  }

  async function saveToken() {
    if (!tokenInput.trim()) return;
    setTokenMsg("Saving token…");
    try {
      await setFyersToken(tokenInput);
      setTokenInput("");
      const res = await refreshAll(book);
      await reload();
      setTokenMsg(res.note ?? `Token saved — updated ${res.refreshed} live price(s).`);
      if (!res.note) setShowToken(false);
    } catch (e) {
      setTokenMsg(`Error: ${e instanceof Error ? e.message : "save failed"}`);
    }
  }

  async function onRefreshOne(t: Trade) {
    try { await refreshOne(t.id); await reload(); }
    catch { /* options will 422 — user should use Edit / Close to set the price manually */ }
  }

  async function onDelete(t: Trade) {
    if (!confirm(`Delete trade ${t.symbol}? This cannot be undone.`)) return;
    await deleteTrade(t.id);
    await reload();
  }

  const visible = useMemo(() => {
    const filtered = filter === "all" ? trades : trades.filter(t => t.status === filter);
    const sign = sortDir === "asc" ? 1 : -1;
    const tsSafe = (s: string | null | undefined) => (s ? new Date(s).getTime() : 0);
    const cmp = (a: Trade, b: Trade): number => {
      let av: any, bv: any;
      switch (sortKey) {
        case "symbol":          av = a.symbol;          bv = b.symbol;          break;
        case "instrument_type": av = a.instrument_type; bv = b.instrument_type; break;
        case "side":            av = a.side;            bv = b.side;            break;
        case "qty":             av = a.qty;             bv = b.qty;             break;
        case "entry_price":     av = a.entry_price;     bv = b.entry_price;     break;
        case "ref_price":       av = a.ref_price;       bv = b.ref_price;       break;
        case "pnl":             av = a.pnl;             bv = b.pnl;             break;
        case "pnl_pct":         av = a.pnl_pct;         bv = b.pnl_pct;         break;
        case "entry_at":        av = tsSafe(a.entry_at); bv = tsSafe(b.entry_at); break;
        case "exit_at":         av = tsSafe(a.exit_at);  bv = tsSafe(b.exit_at);  break;
      }
      if (typeof av === "string") return sign * av.localeCompare(bv ?? "");
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sign * ((av as number) - (bv as number));
    };
    return [...filtered].sort(cmp);
  }, [trades, filter, sortKey, sortDir]);

  function fmtDt(s: string | null | undefined): string {
    return fmtIsoDateTime(s);
  }
  function durationFor(t: Trade): string {
    if (!t.exit_at || !t.entry_at) return "—";
    const ms = new Date(t.exit_at).getTime() - new Date(t.entry_at).getTime();
    if (Number.isNaN(ms) || ms < 0) return "—";
    const totalMin = Math.floor(ms / 60_000);
    const d = Math.floor(totalMin / 1440);
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  function SortHeader({ k, align, children }: { k: SortKey; align?: "left" | "right"; children: React.ReactNode }) {
    const active = sortKey === k;
    const dir = active ? sortDir : null;
    const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th
        className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"} cursor-pointer select-none hover:text-gray-200`}
        onClick={() => toggleSort(k)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          <Icon size={11} className={active ? "text-brand-400" : "text-gray-600"} />
        </span>
      </th>
    );
  }

  const openTrades = useMemo(() => trades.filter(t => t.status === "open"), [trades]);
  const closedTrades = useMemo(() => trades.filter(t => t.status === "closed"), [trades]);
  const colCount = book === "paper" ? 13 : 12;

  return (
    <div className="flex flex-col h-full min-h-0 -m-6">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-white">Trades & P&L</h1>
          <div className="flex items-center rounded-lg border border-gray-700 overflow-hidden text-xs">
            {(["actual", "paper"] as const).map(b => (
              <button
                key={b}
                onClick={() => switchBook(b)}
                className={`px-3 py-1 capitalize transition ${
                  book === b
                    ? b === "paper" ? "bg-amber-600 text-white" : "bg-brand-600 text-white"
                    : "bg-gray-800 text-gray-300 hover:text-white"
                }`}
                title={b === "paper" ? "Paper (simulated) trades" : "Real / actual trades"}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              onClick={sendSelectedToTelegram}
              disabled={sending}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs disabled:opacity-50"
              title="Send selected trades to Telegram"
            >
              {sending ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
              Send {selected.size} to Telegram
            </button>
          )}
          <button
            onClick={onRefreshAll}
            disabled={refreshing}
            className="flex items-center gap-1 px-2 py-1 rounded border border-gray-700 text-xs text-gray-300 hover:text-white disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Refresh prices
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-500 text-white text-xs"
          >
            <Plus size={14} /> New {book === "paper" ? "paper " : ""}trade
          </button>
        </div>
      </div>

      {tokenMsg && (
        <div className="text-xs px-3 py-2 rounded-lg bg-gray-800/60 border border-gray-700 text-gray-300 flex items-center gap-2 flex-wrap">
          <span className={tokenMsg.startsWith("Error") ? "text-red-300" : ""}>{tokenMsg}</span>
          {showToken && (
            <span className="flex items-center gap-1 ml-auto">
              <input type="password" value={tokenInput} onChange={e => setTokenInput(e.target.value)}
                placeholder="Paste fresh Fyers access token"
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-gray-100 w-72" />
              <button onClick={saveToken} disabled={!tokenInput.trim()}
                className="px-2 py-1 rounded bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50">
                Save &amp; refresh
              </button>
            </span>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Dashboard */}
        {dash && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                label="Realized P&L"
                value={inr(dash.realized_pnl)}
                sub={`${dash.closed_count} closed`}
                accent={dash.realized_pnl >= 0 ? "pos" : "neg"}
              />
              <StatCard
                label="Unrealized P&L"
                value={inr(dash.unrealized_pnl)}
                sub={`${dash.open_count} open`}
                accent={dash.unrealized_pnl >= 0 ? "pos" : "neg"}
              />
              <StatCard
                label="Total P&L"
                value={inr(dash.total_pnl)}
                sub={`${dash.total_count} trades`}
                accent={dash.total_pnl >= 0 ? "pos" : "neg"}
              />
              <StatCard
                label="Win rate"
                value={dash.win_rate != null ? `${dash.win_rate}%` : "—"}
                sub={dash.closed_count > 0 ? `${dash.wins}W / ${dash.losses}L` : "no closed trades"}
              />
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              {Object.entries(dash.by_instrument_type).map(([k, v]) => (
                <div key={k} className="px-3 py-1.5 rounded border border-gray-800 bg-gray-900">
                  <span className="capitalize text-gray-400">{k}</span>
                  <span className="ml-2 text-gray-300">{v.open}o / {v.closed}c</span>
                  <span className={`ml-2 font-mono tabular-nums ${pctColor(v.realized_pnl + v.unrealized_pnl)}`}>
                    {inr(v.realized_pnl + v.unrealized_pnl)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Filter tabs */}
        <div className="flex items-center gap-1 text-xs">
          {(["open", "closed", "all"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded capitalize border ${
                filter === f
                  ? "bg-brand-600 border-brand-500 text-white"
                  : "bg-gray-800 border-gray-700 text-gray-300 hover:text-white"
              }`}
            >
              {f} ({f === "open" ? openTrades.length : f === "closed" ? closedTrades.length : trades.length})
            </button>
          ))}
        </div>

        {sendMsg && (
          <div className={`text-xs px-3 py-2 rounded-lg ${sendMsg.startsWith("Error") ? "bg-red-950/40 text-red-300" : "bg-green-950/40 text-green-300"}`}>
            {sendMsg}
          </div>
        )}

        {/* Trades table */}
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-900 text-gray-400">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 accent-sky-500 align-middle"
                    title="Select all shown"
                    checked={visible.length > 0 && visible.every(t => selected.has(t.id))}
                    onChange={e => {
                      setSelected(prev => {
                        const next = new Set(prev);
                        if (e.target.checked) visible.forEach(t => next.add(t.id));
                        else visible.forEach(t => next.delete(t.id));
                        return next;
                      });
                    }}
                  />
                </th>
                <SortHeader k="symbol">Symbol</SortHeader>
                <SortHeader k="instrument_type">Type</SortHeader>
                <SortHeader k="side">Side</SortHeader>
                <SortHeader k="qty" align="right">Qty</SortHeader>
                <SortHeader k="entry_price" align="right">Entry</SortHeader>
                <SortHeader k="ref_price" align="right">Current / Exit</SortHeader>
                <SortHeader k="pnl" align="right">P&L</SortHeader>
                <SortHeader k="pnl_pct" align="right">%</SortHeader>
                <SortHeader k="entry_at">Entered</SortHeader>
                <SortHeader k="exit_at">Exited / Held</SortHeader>
                {book === "paper" && <th className="px-3 py-2 text-left">Rationale</th>}
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 bg-gray-950">
              {loading && (
                <tr><td colSpan={colCount} className="text-gray-500 text-center py-6">Loading…</td></tr>
              )}
              {!loading && visible.length === 0 && (
                <tr><td colSpan={colCount} className="text-gray-500 text-center py-6">No {book} trades yet — click <span className="text-white">+ New {book === "paper" ? "paper " : ""}trade</span> to log one.</td></tr>
              )}
              {visible.map(t => (
                <tr key={t.id} className={`hover:bg-gray-900/70 ${selected.has(t.id) ? "bg-sky-500/5" : ""}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 accent-sky-500 align-middle"
                      checked={selected.has(t.id)}
                      onChange={() => toggleSelect(t.id)}
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-100 font-mono">{t.symbol}</td>
                  <td className="px-3 py-2 capitalize text-gray-300">{t.instrument_type}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider ${
                      t.side === "buy" ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"
                    }`}>{t.side}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-300">
                    {t.num_lots}×{t.lot_size}<br/>
                    <span className="text-[10px] text-gray-500">{t.qty}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-200">{inr(t.entry_price)}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-200">
                    {t.status === "closed" ? inr(t.exit_price) : inr(t.current_price)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${pctColor(t.pnl)}`}>{inr(t.pnl)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${pctColor(t.pnl_pct)}`}>
                    {t.pnl_pct != null ? t.pnl_pct.toFixed(2) + "%" : "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{fmtDt(t.entry_at)}</td>
                  <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                    {t.status === "closed" ? (
                      <span>
                        {fmtDt(t.exit_at)}
                        <span className="block text-[10px] text-gray-600">held {durationFor(t)}</span>
                      </span>
                    ) : (
                      <span className="text-gray-600">open</span>
                    )}
                  </td>
                  {book === "paper" && (
                    <td className="px-3 py-2 text-gray-400 max-w-[16rem] truncate" title={t.rationale ?? ""}>
                      {t.rationale || <span className="text-gray-600">—</span>}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {t.status === "open" && (
                      <>
                        {t.instrument_type !== "option" && (
                          <button
                            onClick={() => onRefreshOne(t)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 mr-1 rounded border border-blue-700/60 bg-blue-600/20 text-blue-200 hover:bg-blue-600/40"
                            title={t.instrument_type === "future"
                              ? "Refresh from underlying spot (yfinance)"
                              : "Refresh live price from yfinance"}
                          >
                            <RefreshCw size={11} /> <span className="text-[10px]">Refresh</span>
                          </button>
                        )}
                        <button
                          onClick={() => setEditing(t)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 mr-1 rounded border border-brand-700/60 bg-brand-600/20 text-brand-200 hover:bg-brand-600/40"
                          title="Edit open trade"
                        >
                          <Pencil size={11} /> <span className="text-[10px]">Edit</span>
                        </button>
                        <button
                          onClick={() => setClosing(t)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 mr-1 rounded border border-green-700/60 bg-green-600/20 text-green-200 hover:bg-green-600/40"
                          title="Close trade with exit price + time"
                        >
                          <CheckCircle2 size={11} /> <span className="text-[10px]">Close</span>
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => onDelete(t)}
                      className="px-1.5 py-0.5 rounded border border-red-700/40 text-red-400 hover:bg-red-700/20"
                      title="Delete"
                    >
                      <X size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <NewTradeForm mode={book} onClose={() => setShowForm(false)} onCreated={reload} />
      )}
      {editing && (
        <EditOpenTradeForm
          trade={editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {closing && (
        <CloseTradeForm
          trade={closing}
          onClose={() => setClosing(null)}
          onClosed={reload}
        />
      )}
    </div>
  );
}
