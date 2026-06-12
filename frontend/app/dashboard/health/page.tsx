"use client";
import { useState } from "react";
import {
  runHealthCheck, getFyersLoginUrl,
  refreshFyersToken, exchangeFyersAuthCode, setFyersAccessToken,
  HealthReport, FyersLoginInfo, TokenUpdateResult,
} from "@/lib/api";
import {
  CheckCircle2, XCircle, RefreshCw, ExternalLink, Heart,
  KeyRound, Zap, ClipboardCopy, Copy,
} from "lucide-react";

type ActionState = "idle" | "running" | "done";

export default function HealthPage() {
  const [report,       setReport]       = useState<HealthReport | null>(null);
  const [running,      setRunning]      = useState(false);
  const [loginInfo,    setLoginInfo]    = useState<FyersLoginInfo | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [authCode,     setAuthCode]     = useState("");
  const [accessToken,  setAccessToken]  = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [banner,       setBanner]       = useState<{ kind: "ok"|"err"; text: string } | null>(null);
  const [action,       setAction]       = useState<ActionState>("idle");

  async function handleRunCheck() {
    setRunning(true); setBanner(null);
    try {
      const r = await runHealthCheck();
      setReport(r);
    } catch (e: unknown) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Health check failed" });
    } finally { setRunning(false); }
  }

  async function handleShowLoginUrl() {
    setLoginLoading(true); setBanner(null);
    try {
      const info = await getFyersLoginUrl();
      setLoginInfo(info);
    } catch (e: unknown) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Could not build login URL" });
    } finally { setLoginLoading(false); }
  }

  function applyResult(r: TokenUpdateResult, fallbackMsg: string) {
    if (r.ok) {
      setBanner({ kind: "ok", text: `${r.message} ${r.token_preview ? `— ${r.token_preview}` : ""}` });
      setAuthCode(""); setAccessToken(""); setRefreshToken("");
      // Re-run health check so the user sees the new status
      handleRunCheck();
    } else {
      setBanner({ kind: "err", text: r.verify?.message || r.message || fallbackMsg });
    }
  }

  async function handleAutoRefresh() {
    setAction("running"); setBanner(null);
    try {
      const r = await refreshFyersToken();
      applyResult(r, "Auto-refresh failed");
    } catch (e: unknown) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Auto-refresh failed" });
    } finally { setAction("done"); }
  }

  async function handleExchangeAuthCode() {
    if (!authCode.trim()) { setBanner({ kind: "err", text: "Paste an auth_code first" }); return; }
    setAction("running"); setBanner(null);
    try {
      const r = await exchangeFyersAuthCode(authCode.trim());
      applyResult(r, "Auth-code exchange failed");
    } catch (e: unknown) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Auth-code exchange failed" });
    } finally { setAction("done"); }
  }

  async function handleSetAccessToken() {
    if (!accessToken.trim()) { setBanner({ kind: "err", text: "Paste an access token first" }); return; }
    setAction("running"); setBanner(null);
    try {
      const r = await setFyersAccessToken(accessToken.trim(), refreshToken.trim() || undefined);
      applyResult(r, "Token update failed");
    } catch (e: unknown) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Token update failed" });
    } finally { setAction("done"); }
  }

  const fyersFailed = report?.checks.find(c => c.name === "Fyers token" && !c.ok);

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Heart size={22} className="text-brand-400" />
          <h1 className="text-2xl font-bold text-white">System Health</h1>
        </div>
        <button
          onClick={handleRunCheck}
          disabled={running}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-60
                     text-white text-sm px-4 py-2 rounded-lg transition"
        >
          <RefreshCw size={14} className={running ? "animate-spin" : ""} />
          {running ? "Running…" : "Run Health Check"}
        </button>
      </div>

      {/* Banner */}
      {banner && (
        <div className={`text-sm px-4 py-2 rounded-lg border ${
          banner.kind === "ok"
            ? "bg-green-950/40 text-green-300 border-green-800"
            : "bg-red-950/40 text-red-300 border-red-800"
        }`}>
          {banner.text}
        </div>
      )}

      {/* Check results */}
      {report && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className={`px-5 py-3 border-b border-gray-800 flex items-center justify-between ${
            report.overall === "ok" ? "bg-green-950/30" : "bg-red-950/30"
          }`}>
            <span className="font-semibold text-white">
              Overall: {report.overall === "ok" ? "Healthy" : "Problems detected"}
            </span>
            <span className="text-xs text-gray-400">
              {new Date(report.checked_at).toLocaleString("en-IN")}
            </span>
          </div>
          {report.checks.map(c => (
            <div key={c.name} className="flex items-start gap-3 px-5 py-3 border-b border-gray-800/50 last:border-b-0">
              {c.ok
                ? <CheckCircle2 size={18} className="text-green-400 mt-0.5 flex-shrink-0" />
                : <XCircle      size={18} className="text-red-400   mt-0.5 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white">{c.name}</div>
                <div className="text-xs text-gray-400 break-all">{c.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Token recovery — only shown when fyers token check fails */}
      {fyersFailed && (
        <div className="bg-gray-900 rounded-xl border border-yellow-900/60 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800 bg-yellow-950/30 flex items-center gap-2">
            <KeyRound size={16} className="text-yellow-400" />
            <span className="font-semibold text-white">Fix Fyers Token</span>
          </div>

          {/* Option 1: automated refresh */}
          <div className="px-5 py-4 border-b border-gray-800/50">
            <div className="text-sm font-medium text-white mb-1">Option 1 — Automated refresh</div>
            <div className="text-xs text-gray-500 mb-3">
              Uses stored <code className="text-gray-400">REFRESH_TOKEN</code> + <code className="text-gray-400">FYERS_PIN</code> from <code className="text-gray-400">.env</code>.
              Works if the refresh token hasn&apos;t itself expired.
            </div>
            <button
              onClick={handleAutoRefresh}
              disabled={action === "running"}
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-60
                         text-white text-sm px-4 py-2 rounded-lg border border-gray-700 transition"
            >
              <Zap size={14} />
              {action === "running" ? "Refreshing…" : "Try refresh token"}
            </button>
          </div>

          {/* Option 2: manual auth_code exchange */}
          <div className="px-5 py-4 border-b border-gray-800/50">
            <div className="text-sm font-medium text-white mb-1">Option 2 — Login & paste auth_code</div>
            <div className="text-xs text-gray-500 mb-3">
              Open the Fyers login URL, complete 2FA. You&apos;ll be redirected to
              the <code className="text-gray-400">redirect_uri</code> with <code className="text-gray-400">?auth_code=…</code> in the URL. Paste just the code below.
            </div>
            <button
              onClick={handleShowLoginUrl}
              disabled={loginLoading}
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-60
                         text-white text-sm px-4 py-2 rounded-lg border border-gray-700 transition mb-3"
            >
              <ExternalLink size={14} />
              {loginLoading ? "Loading…" : loginInfo ? "Reload URL" : "Get Fyers login URL"}
            </button>
            {loginInfo && (
              <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 mb-3 space-y-2">
                <div className="flex items-start gap-2">
                  <a
                    href={loginInfo.login_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand-400 hover:text-brand-300 break-all flex-1 font-mono"
                  >
                    {loginInfo.login_url}
                  </a>
                  <button
                    onClick={() => navigator.clipboard.writeText(loginInfo.login_url)}
                    className="p-1 text-gray-400 hover:text-white flex-shrink-0"
                    title="Copy URL"
                  >
                    <Copy size={14} />
                  </button>
                </div>
                <div className="text-xs text-gray-500">
                  Redirect: <span className="text-gray-400 font-mono">{loginInfo.redirect_uri}</span>
                </div>
                <pre className="text-xs text-gray-500 whitespace-pre-wrap">{loginInfo.instructions}</pre>
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={authCode}
                onChange={e => setAuthCode(e.target.value)}
                placeholder="Paste auth_code from redirect URL"
                className="flex-1 bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700
                           focus:outline-none focus:border-brand-500 font-mono"
              />
              <button
                onClick={handleExchangeAuthCode}
                disabled={action === "running" || !authCode.trim()}
                className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-60
                           text-white text-sm px-4 py-2 rounded-lg transition"
              >
                <ClipboardCopy size={14} />
                Exchange
              </button>
            </div>
          </div>

          {/* Option 3: direct access token paste */}
          <div className="px-5 py-4">
            <div className="text-sm font-medium text-white mb-1">Option 3 — Paste access token directly</div>
            <div className="text-xs text-gray-500 mb-3">
              If you already have a valid access token (e.g. from running <code className="text-gray-400">python auth.py</code>),
              paste it here. Refresh token is optional.
            </div>
            <input
              value={accessToken}
              onChange={e => setAccessToken(e.target.value)}
              placeholder="access_token"
              className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700
                         focus:outline-none focus:border-brand-500 font-mono mb-2"
            />
            <input
              value={refreshToken}
              onChange={e => setRefreshToken(e.target.value)}
              placeholder="refresh_token (optional)"
              className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700
                         focus:outline-none focus:border-brand-500 font-mono mb-3"
            />
            <button
              onClick={handleSetAccessToken}
              disabled={action === "running" || !accessToken.trim()}
              className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-60
                         text-white text-sm px-4 py-2 rounded-lg transition"
            >
              <KeyRound size={14} />
              Save token
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
