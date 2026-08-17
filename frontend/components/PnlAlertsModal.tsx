"use client";
import { useEffect, useState } from "react";
import { X, Bell, Send, RefreshCw, Check, AlertTriangle } from "lucide-react";
import {
  PnlConfig, PnlNotification,
  getPnlConfig, setPnlConfig, getPnlNotifications, runEodSummary,
} from "@/lib/pnlApi";

const KIND_LABEL: Record<string, string> = { profit: "Profit", loss: "Loss", expiry: "Expiry", eod: "EOD" };

export default function PnlAlertsModal({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<PnlConfig | null>(null);
  const [notifs, setNotifs] = useState<PnlNotification[]>([]);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    getPnlConfig().then(setCfg).catch(() => setMsg("Failed to load settings"));
    getPnlNotifications(30).then(setNotifs).catch(() => {});
  }, []);

  function set<K extends keyof PnlConfig>(k: K, v: PnlConfig[K]) {
    setCfg(c => (c ? { ...c, [k]: v } : c));
  }
  const num = (v: string, min = 0) => Math.max(min, Number(v) || 0);

  async function save() {
    if (!cfg) return;
    setSaving(true); setMsg(null);
    try {
      const saved = await setPnlConfig(cfg);
      setCfg(saved);
      setMsg("Saved");
      setTimeout(() => setMsg(null), 2000);
    } catch (e: any) {
      setMsg((e?.message || "Save failed").replace(/^API \d+:\s*/, ""));
    } finally { setSaving(false); }
  }

  async function sendNow() {
    setSending(true); setMsg(null);
    try {
      const r = await runEodSummary();
      setMsg(r.skipped ? `Skipped: ${r.skipped}` : `Sent summary — ${r.positions} position(s), ${r.charts ?? 0} chart(s)`);
      getPnlNotifications(30).then(setNotifs).catch(() => {});
    } catch (e: any) {
      setMsg((e?.message || "Send failed").replace(/^API \d+:\s*/, ""));
    } finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 sticky top-0 bg-gray-900">
          <h2 className="font-semibold text-white flex items-center gap-2"><Bell size={16} className="text-brand-500" /> P&L Alerts</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button>
        </div>

        {!cfg ? (
          <div className="p-8 text-center text-gray-500 text-sm">Loading…</div>
        ) : (
          <div className="p-5 space-y-5 text-sm">
            <label className="flex items-center gap-2 text-gray-200">
              <input type="checkbox" checked={cfg.enabled} onChange={e => set("enabled", e.target.checked)} className="accent-brand-500" />
              Enable profit/loss alerts (market hours only)
            </label>

            {/* Profit */}
            <div className="rounded-lg border border-gray-800 p-3 space-y-2">
              <div className="text-green-400 font-medium text-xs uppercase tracking-wider">Profit alert</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Trigger at ₹ profit ≥">
                  <input type="number" value={cfg.profit_threshold} onChange={e => set("profit_threshold", num(e.target.value))} className={inp} />
                </Field>
                <Field label="Re-alert every (min)">
                  <input type="number" value={cfg.profit_interval_min} onChange={e => set("profit_interval_min", num(e.target.value, 1))} className={inp} />
                </Field>
              </div>
            </div>

            {/* Loss */}
            <div className="rounded-lg border border-gray-800 p-3 space-y-2">
              <div className="text-red-400 font-medium text-xs uppercase tracking-wider">Loss alert</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Trigger at ₹ loss ≥">
                  <input type="number" value={cfg.loss_threshold} onChange={e => set("loss_threshold", num(e.target.value))} className={inp} />
                </Field>
                <Field label="Re-alert every (min)">
                  <input type="number" value={cfg.loss_interval_min} onChange={e => set("loss_interval_min", num(e.target.value, 1))} className={inp} />
                </Field>
              </div>
            </div>

            {/* Other */}
            <div className="grid grid-cols-3 gap-3">
              <Field label="Check every (min)">
                <input type="number" value={cfg.base_check_min} onChange={e => set("base_check_min", num(e.target.value, 1))} className={inp} />
              </Field>
              <Field label="EOD summary (IST)">
                <input type="time" value={cfg.eod_time} onChange={e => set("eod_time", e.target.value)} className={inp} />
              </Field>
              <Field label="Expiry warn (≤ td)">
                <input type="number" value={cfg.expiry_trading_days} onChange={e => set("expiry_trading_days", num(e.target.value))} className={inp} />
              </Field>
            </div>
            <p className="text-[11px] text-gray-500 -mt-2">
              Alerts &amp; the 4pm summary cover both Actual and Paper books (each labelled), include a chart, and are sent to Telegram.
              Keep “check every” ≤ the shortest re-alert interval.
            </p>

            <div className="flex items-center gap-2">
              <button onClick={save} disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-500 text-white text-xs disabled:opacity-50">
                {saving ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />} Save settings
              </button>
              <button onClick={sendNow} disabled={sending}
                className="flex items-center gap-1 px-3 py-1.5 rounded border border-gray-700 text-gray-200 hover:text-white text-xs disabled:opacity-50"
                title="Send the EOD P&L summary to Telegram right now">
                {sending ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />} Send summary now
              </button>
              {msg && <span className="text-xs text-gray-300">{msg}</span>}
            </div>

            {/* Recent notifications */}
            <div className="rounded-lg border border-gray-800 overflow-hidden">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-800">Recent alerts</div>
              {notifs.length === 0 && <div className="px-3 py-3 text-xs text-gray-500">No P&L alerts fired yet.</div>}
              {notifs.map(n => (
                <div key={n.id} className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-gray-800/60 last:border-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    n.kind === "profit" ? "bg-green-500/15 text-green-300"
                    : n.kind === "loss" ? "bg-red-500/15 text-red-300"
                    : n.kind === "expiry" ? "bg-amber-500/15 text-amber-300"
                    : "bg-gray-600/20 text-gray-300"}`}>{KIND_LABEL[n.kind] || n.kind}</span>
                  <span className="text-gray-200 truncate flex-1">{n.symbol || "EOD summary"}{n.pnl != null ? ` · ₹${Math.round(n.pnl).toLocaleString()}` : ""}</span>
                  <span className="text-gray-500">{new Date(n.triggered_at).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</span>
                  {n.delivered ? <Check size={12} className="text-green-400" /> : <AlertTriangle size={12} className="text-red-400" />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const inp = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
