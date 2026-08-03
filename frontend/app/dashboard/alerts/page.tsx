"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, X, Pencil, Trash2, RotateCcw, Search, Check, AlertTriangle } from "lucide-react";
import ChartsChart, { RefLine } from "@/components/ChartsChart";
import { searchSymbols, SymbolMatch, getLiveCandles } from "@/lib/liveSources";
import {
  AlertRow, AlertSymbol, AlertNotification, AlertCond, AlertRepeat, CreateAlertBody,
  listAlerts, getAlertSymbols, createAlert, updateAlert, deleteAlert,
  getAlertNotifications, getAlertConfig, setAlertConfig,
} from "@/lib/alertsApi";

const TIMEFRAMES = ["5m", "15m", "1h", "1d", "1wk", "1mo"];
const TF_LABEL: Record<string, string> = { "5m": "5m", "15m": "15m", "1h": "1h", "1d": "1D", "1wk": "1W", "1mo": "1M" };
const POLL_MS = 30_000;

type Draft = {
  editingId?: number;
  kind: "horizontal" | "trend";
  price?: number;
  t1?: number; p1?: number; t2?: number; p2?: number;
  name: string; condition: AlertCond; repeat: AlertRepeat; note: string;
};
const short = (s: string) => s.replace("NSE:", "").replace("-EQ", "");

export default function AlertsPage() {
  const [symbols, setSymbols] = useState<AlertSymbol[]>([]);
  const [symbol, setSymbol] = useState<string>("");
  const [timeframe, setTimeframe] = useState("1d");
  const [candles, setCandles] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [notifs, setNotifs] = useState<AlertNotification[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [checkMin, setCheckMin] = useState(5);

  const [symDraft, setSymDraft] = useState("");
  const [sugg, setSugg] = useState<SymbolMatch[]>([]);
  const symRef = useRef(symbol); symRef.current = symbol;
  const tfRef = useRef(timeframe); tfRef.current = timeframe;

  // bootstrap
  useEffect(() => {
    getAlertConfig().then(c => setCheckMin(c.check_minutes)).catch(() => {});
    getAlertSymbols().then(s => { setSymbols(s); if (s.length && !symRef.current) setSymbol(s[0].symbol); }).catch(() => {});
    getAlertNotifications(undefined, 100).then(setNotifs).catch(() => {});
  }, []);

  const loadChart = useCallback(async (sym: string, tf: string) => {
    if (!sym) { setCandles([]); return; }
    setLoadingChart(true);
    try { setCandles(await getLiveCandles("fyers", sym, tf, 400)); }
    catch { setCandles([]); } finally { setLoadingChart(false); }
  }, []);

  const loadAlerts = useCallback(async (sym: string) => {
    if (!sym) { setAlerts([]); return; }
    try { setAlerts(await listAlerts(sym)); } catch {}
  }, []);

  useEffect(() => { loadChart(symbol, timeframe); }, [symbol, timeframe, loadChart]);
  useEffect(() => { loadAlerts(symbol); }, [symbol, loadAlerts]);

  // poll for triggered status + notifications while open
  useEffect(() => {
    const id = window.setInterval(() => {
      loadAlerts(symRef.current);
      getAlertSymbols().then(setSymbols).catch(() => {});
      getAlertNotifications(undefined, 100).then(setNotifs).catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [loadAlerts]);

  // symbol search
  useEffect(() => {
    let cancelled = false;
    const h = window.setTimeout(async () => {
      if (!symDraft.trim()) { setSugg([]); return; }
      try { const r = await searchSymbols("fyers", symDraft, 20); if (!cancelled) setSugg(r); } catch {}
    }, 200);
    return () => { cancelled = true; window.clearTimeout(h); };
  }, [symDraft]);

  function chooseSymbol(s: string) { setSymbol(s.trim().toUpperCase()); setSymDraft(""); setSugg([]); }

  // Existing alerts rendered as non-interactive reference lines on the chart.
  const refLines = useMemo<RefLine[]>(() => alerts.map(a => {
    const active = a.status === "active";
    const color = !active ? "#94a3b8" : a.condition === "cross_up" ? "#16a34a" : "#dc2626";
    return a.kind === "horizontal"
      ? { kind: "hline", price: a.price ?? undefined, color, dashed: !active, label: (a.name || "alert") + (active ? "" : " ✓") }
      : { kind: "trend", t1: a.t1 ?? undefined, p1: a.p1 ?? undefined, t2: a.t2 ?? undefined, p2: a.p2 ?? undefined, color, dashed: !active, label: a.name || "alert", timeframe: a.timeframe };
  }), [alerts]);

  // Draw a line → click it → "+ Alert": create a server alert from the drawing's geometry.
  const onCreateAlert = useCallback(async (d: any, condition: AlertCond, repeat: AlertRepeat) => {
    try {
      const body: CreateAlertBody = {
        symbol, timeframe, condition, repeat_mode: repeat,
        kind: d.kind === "trend" ? "trend" : "horizontal",
        ...(d.kind === "trend" ? { t1: d.t1, p1: d.p1, t2: d.t2, p2: d.p2 } : { price: d.price }),
      };
      await createAlert(body);
      await loadAlerts(symbol); getAlertSymbols().then(setSymbols).catch(() => {});
      setMsg("Alert created"); setTimeout(() => setMsg(null), 2000);
      return true;
    } catch (e: any) { setMsg((e?.message || "Create failed").replace(/^API \d+:\s*/, "")); return false; }
  }, [symbol, timeframe, loadAlerts]);

  async function saveDraft() {
    if (!draft) return;
    try {
      if (draft.editingId) {
        await updateAlert(draft.editingId, {
          name: draft.name, condition: draft.condition, repeat_mode: draft.repeat, note: draft.note,
          ...(draft.kind === "horizontal" ? { price: draft.price } : { t1: draft.t1, p1: draft.p1, t2: draft.t2, p2: draft.p2 }),
        });
      } else {
        const body: CreateAlertBody = {
          symbol, timeframe, kind: draft.kind, condition: draft.condition, repeat_mode: draft.repeat,
          name: draft.name || undefined, note: draft.note || undefined,
          ...(draft.kind === "horizontal" ? { price: draft.price } : { t1: draft.t1, p1: draft.p1, t2: draft.t2, p2: draft.p2 }),
        };
        await createAlert(body);
      }
      setDraft(null); await loadAlerts(symbol); getAlertSymbols().then(setSymbols).catch(() => {});
    } catch (e: any) { setMsg((e?.message || "Save failed").replace(/^API \d+:\s*/, "")); }
  }

  function editAlert(a: AlertRow) {
    setDraft({
      editingId: a.id, kind: a.kind, name: a.name || "", condition: a.condition, repeat: a.repeat_mode, note: a.note || "",
      price: a.price ?? undefined, t1: a.t1 ?? undefined, p1: a.p1 ?? undefined, t2: a.t2 ?? undefined, p2: a.p2 ?? undefined,
    });
  }
  async function removeAlert(a: AlertRow) {
    if (!confirm(`Delete alert${a.name ? ` "${a.name}"` : ""} on ${short(a.symbol)}?`)) return;
    await deleteAlert(a.id).catch(() => {}); await loadAlerts(symbol); getAlertSymbols().then(setSymbols).catch(() => {});
  }
  async function rearm(a: AlertRow) { await updateAlert(a.id, { status: "active" }).catch(() => {}); await loadAlerts(symbol); }
  async function toggleDisable(a: AlertRow) { await updateAlert(a.id, { status: a.status === "disabled" ? "active" : "disabled" }).catch(() => {}); await loadAlerts(symbol); }

  async function saveInterval() {
    try { const r = await setAlertConfig(checkMin); setCheckMin(r.check_minutes); setMsg(`Check interval set to ${r.check_minutes}m`); setTimeout(() => setMsg(null), 2500); }
    catch (e: any) { setMsg((e?.message || "failed").replace(/^API \d+:\s*/, "")); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-white flex items-center gap-2"><Bell size={20} className="text-brand-500" /> Alerts</h1>
        <label className="flex items-center gap-1.5 text-xs text-gray-400">Check every
          <input type="number" min={1} max={240} value={checkMin} onChange={e => setCheckMin(Math.max(1, Number(e.target.value) || 5))} className="w-14 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />m
          <button onClick={saveInterval} className="px-2 py-1 rounded bg-gray-800 border border-gray-700 hover:text-white">save</button>
          <span className="text-gray-600">· runs on market hours</span>
        </label>
      </div>
      {msg && <div className="text-xs px-3 py-2 rounded-lg bg-gray-800/60 text-gray-200">{msg}</div>}

      <div className="flex gap-4 min-h-0">
        {/* Saved charts */}
        <div className="w-52 shrink-0 space-y-2">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
            <input list="alert-sym-dl" value={symDraft} onChange={e => setSymDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && symDraft.trim()) chooseSymbol(symDraft); }}
              placeholder="chart a stock…" className="w-full bg-gray-800 border border-gray-700 rounded pl-7 pr-2 py-1.5 text-xs text-gray-100" />
            <datalist id="alert-sym-dl">{sugg.map(s => <option key={s.symbol} value={s.symbol}>{s.label}</option>)}</datalist>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-800">Saved charts</div>
            {symbols.length === 0 && <div className="px-3 py-3 text-xs text-gray-500">No alerts yet.</div>}
            {symbols.map(s => (
              <button key={s.symbol} onClick={() => chooseSymbol(s.symbol)}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-xs border-l-2 ${symbol === s.symbol ? "bg-brand-600/10 border-brand-500 text-white" : "border-transparent text-gray-300 hover:bg-gray-800/60"}`}>
                <span className="font-medium">{short(s.symbol)}</span>
                <span className="text-[10px] text-gray-500">{s.active}/{s.total}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Chart + draw */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-white">{symbol ? short(symbol) : "Pick a stock"}</span>
            <div className="flex items-center rounded-lg border border-gray-700 overflow-hidden text-xs">
              {TIMEFRAMES.map(tf => (
                <button key={tf} onClick={() => setTimeframe(tf)} className={`px-2 py-1 ${timeframe === tf ? "bg-brand-600 text-white" : "bg-gray-800 text-gray-300 hover:text-white"}`}>{TF_LABEL[tf]}</button>
              ))}
            </div>
            <span className="ml-auto text-[11px] text-gray-400">draw a line → click it → <b className="text-blue-400">+ Alert</b></span>
          </div>

          {loadingChart ? <div className="h-[520px] flex items-center justify-center text-gray-500 text-sm bg-gray-900 rounded-lg border border-gray-800">Loading chart…</div>
            : symbol ? <ChartsChart candles={candles} symbol={symbol} timeframe={timeframe} height={520} lsPrefix="alertdraw" refLines={refLines} onCreateAlert={onCreateAlert} />
            : <div className="h-[520px] flex items-center justify-center text-gray-500 text-sm bg-white rounded-lg border border-gray-200">Pick a stock to chart.</div>}

          {/* Alerts table */}
          <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-400 border-b border-gray-800">
                <tr><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">TF</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Condition</th><th className="px-3 py-2 text-right">Level</th><th className="px-3 py-2 text-left">Repeat</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {alerts.length === 0 && <tr><td colSpan={8} className="text-center py-5 text-gray-500">{symbol ? "No alerts on this stock — draw a line to add one." : "Pick a stock."}</td></tr>}
                {alerts.map(a => (
                  <tr key={a.id} className="hover:bg-gray-800/40">
                    <td className="px-3 py-2 text-gray-100">{a.name || <span className="text-gray-500">—</span>}</td>
                    <td className="px-3 py-2 text-gray-400">{TF_LABEL[a.timeframe] || a.timeframe}</td>
                    <td className="px-3 py-2 text-gray-300 capitalize">{a.kind}</td>
                    <td className="px-3 py-2"><span className={a.condition === "cross_up" ? "text-green-400" : "text-red-400"}>{a.condition === "cross_up" ? "crosses ↑" : "crosses ↓"}</span></td>
                    <td className="px-3 py-2 text-right font-mono text-gray-200">{a.kind === "horizontal" ? a.price : a.line_now != null ? `${a.line_now}*` : "—"}</td>
                    <td className="px-3 py-2 text-gray-400">{a.repeat_mode}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${a.status === "active" ? "bg-green-500/15 text-green-300" : a.status === "triggered" ? "bg-amber-500/15 text-amber-300" : "bg-gray-600/20 text-gray-400"}`}>{a.status}</span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {a.status === "triggered" && <button onClick={() => rearm(a)} title="Re-arm" className="px-1.5 py-0.5 mr-1 rounded border border-green-700/50 text-green-300 hover:bg-green-700/20"><RotateCcw size={11} /></button>}
                      <button onClick={() => toggleDisable(a)} title={a.status === "disabled" ? "Enable" : "Disable"} className="px-1.5 py-0.5 mr-1 rounded border border-gray-700 text-gray-300 hover:text-white">{a.status === "disabled" ? "on" : "off"}</button>
                      <button onClick={() => editAlert(a)} title="Edit" className="px-1.5 py-0.5 mr-1 rounded border border-brand-700/50 text-brand-200 hover:bg-brand-600/20"><Pencil size={11} /></button>
                      <button onClick={() => removeAlert(a)} title="Delete" className="px-1.5 py-0.5 rounded border border-red-700/40 text-red-400 hover:bg-red-700/20"><Trash2 size={11} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-1 text-[10px] text-gray-600">* trendline value at now (moves along the line)</div>
          </div>
        </div>
      </div>

      {/* Notifications log */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-x-auto">
        <div className="px-4 py-2 text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">Triggered notifications</div>
        <table className="w-full text-xs">
          <thead className="text-gray-400 border-b border-gray-800"><tr><th className="px-3 py-2 text-left">Time</th><th className="px-3 py-2 text-left">Stock</th><th className="px-3 py-2 text-center">Dir</th><th className="px-3 py-2 text-right">LTP</th><th className="px-3 py-2 text-right">Line</th><th className="px-3 py-2 text-center">Telegram</th></tr></thead>
          <tbody className="divide-y divide-gray-800/60">
            {notifs.length === 0 && <tr><td colSpan={6} className="text-center py-5 text-gray-500">No alerts have fired yet.</td></tr>}
            {notifs.map(n => (
              <tr key={n.id}>
                <td className="px-3 py-2 text-gray-400">{new Date(n.triggered_at).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</td>
                <td className="px-3 py-2 text-gray-100">{short(n.symbol)}</td>
                <td className="px-3 py-2 text-center">{n.direction === "up" ? <span className="text-green-400">↑</span> : <span className="text-red-400">↓</span>}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-200">{n.price}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-400">{n.line_value}</td>
                <td className="px-3 py-2 text-center">
                  {n.delivered ? <span className="inline-flex items-center gap-1 text-green-300" title="Delivered to Telegram"><Check size={12} /> sent</span>
                    : <span className="inline-flex items-center gap-1 text-red-300" title={n.error || "Not delivered"}><AlertTriangle size={12} /> failed</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create / edit popup */}
      {draft && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) setDraft(null); }}>
          <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-lg shadow-2xl text-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <h2 className="font-semibold text-white">{draft.editingId ? "Edit alert" : "Create alert"} · {short(symbol)}</h2>
              <button onClick={() => setDraft(null)} className="text-gray-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div><label className="block text-xs text-gray-400 mb-1">Name</label>
                <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. breakout level" className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-xs text-gray-400 mb-1">Condition</label>
                  <select value={draft.condition} onChange={e => setDraft({ ...draft, condition: e.target.value as AlertCond })} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100">
                    <option value="cross_up">Crosses up ↑</option><option value="cross_down">Crosses down ↓</option>
                  </select></div>
                <div><label className="block text-xs text-gray-400 mb-1">Trigger</label>
                  <select value={draft.repeat} onChange={e => setDraft({ ...draft, repeat: e.target.value as AlertRepeat })} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100">
                    <option value="once">Once</option><option value="recurring">Every re-cross</option>
                  </select></div>
              </div>
              {draft.kind === "horizontal" ? (
                <div><label className="block text-xs text-gray-400 mb-1">Price level</label>
                  <input type="number" step="any" value={draft.price ?? ""} onChange={e => setDraft({ ...draft, price: parseFloat(e.target.value) })} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100" /></div>
              ) : (
                <div className="text-[11px] text-gray-400 bg-gray-800/50 rounded px-2 py-1.5">Trendline on {TF_LABEL[timeframe]} · {draft.p1?.toFixed(2)} → {draft.p2?.toFixed(2)} (fires when price crosses the line)</div>
              )}
              <div><label className="block text-xs text-gray-400 mb-1">Note (optional)</label>
                <input value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100" /></div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-800">
              <button onClick={() => setDraft(null)} className="px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:text-white text-xs">Cancel</button>
              <button onClick={saveDraft} className="px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-500 text-white text-xs">{draft.editingId ? "Save" : "Create alert"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
