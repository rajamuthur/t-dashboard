"use client";
import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle2, XCircle, ExternalLink, LogIn } from "lucide-react";
import { getFyersStatus, fyersLogin, getFyersAuthUrl, fyersExchange, FyersStatus } from "@/lib/fyersApi";

export default function FyersConnectionCard() {
  const [status, setStatus] = useState<FyersStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState("");

  async function loadStatus() {
    try { setStatus(await getFyersStatus()); } catch { setStatus({ connected: false, message: "status unavailable" }); }
  }
  useEffect(() => { loadStatus(); }, []);

  async function run(fn: () => Promise<{ ok?: boolean; message: string }>, label: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      setMsg(`✓ ${r.message || label + " ok"}`);
      await loadStatus();
    } catch (e: any) {
      setMsg(`✗ ${(e?.message || label + " failed").slice(0, 300)}`);
    } finally { setBusy(false); }
  }

  async function openAuthUrl() {
    try { const { url } = await getFyersAuthUrl(); window.open(url, "_blank"); }
    catch (e: any) { setMsg(`✗ ${e?.message || "could not get login URL"}`); }
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Fyers Connection</h3>
        <button onClick={loadStatus} className="text-gray-400 hover:text-white" title="Refresh status">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 text-sm">
        {status?.connected
          ? <><CheckCircle2 size={16} className="text-green-400" /><span className="text-green-300">{status.message}</span></>
          : <><XCircle size={16} className="text-red-400" /><span className="text-red-300">{status?.message ?? "Checking…"}</span></>}
      </div>

      <p className="text-xs text-gray-500 leading-relaxed">
        Fyers tokens expire every morning and Fyers disabled programmatic refresh (SEBI). The
        <b className="text-gray-300"> auto-login</b> below mints a fresh token using your TOTP secret — set
        <code className="text-gray-300"> FYERS_ID</code> and <code className="text-gray-300">FYERS_TOTP_SECRET</code> in
        <code className="text-gray-300"> .env</code>, then run <code className="text-gray-300">scripts\install-fyers-login.ps1</code>
        once to schedule it daily at 8:15 AM. Use the button to log in on demand.
      </p>

      {/* Auto-login */}
      <button onClick={() => run(fyersLogin, "auto-login")} disabled={busy}
        className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white text-sm rounded-lg px-4 py-2">
        {busy ? <RefreshCw size={14} className="animate-spin" /> : <LogIn size={14} />} Login now (TOTP auto)
      </button>

      {/* Manual fallback */}
      <div className="border-t border-gray-800 pt-3 space-y-2">
        <p className="text-xs text-gray-500">Manual fallback (no TOTP secret): open the login link, then paste the <code>auth_code</code> from the redirected URL.</p>
        <button onClick={openAuthUrl} className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300">
          <ExternalLink size={12} /> Open Fyers login link
        </button>
        <div className="flex gap-2">
          <input value={authCode} onChange={e => setAuthCode(e.target.value)} placeholder="Paste auth_code…"
            className="flex-1 bg-gray-800 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-700 focus:border-brand-500 outline-none" />
          <button onClick={() => run(() => fyersExchange(authCode.trim()), "exchange")} disabled={busy || !authCode.trim()}
            className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm rounded-lg px-4">Connect</button>
        </div>
      </div>

      {msg && <div className={`text-xs ${msg.startsWith("✓") ? "text-green-300" : "text-red-300"}`}>{msg}</div>}
    </div>
  );
}
