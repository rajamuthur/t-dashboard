"use client";
import { useEffect, useState, useCallback } from "react";
import {
  getConfig, setConfig, refreshFoStocks,
  WeekBucket,
} from "@/lib/api";
import {
  getTelegramConfig, saveTelegramConfig, testTelegram,
} from "@/lib/telegramApi";
import StockListEditor from "@/components/StockListEditor";
import FyersConnectionCard from "@/components/FyersConnectionCard";
import { RefreshCw, Save, Check, AlertCircle, Send } from "lucide-react";

// ── Tiny reusable helpers ─────────────────────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {children}
    </div>
  );
}
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs text-gray-400 mb-1">{children}</label>;
}
function Input({ value, onChange, type = "text", placeholder = "" }: {
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <input
      type={type} value={value} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-1.5
                 border border-gray-700 focus:outline-none focus:border-brand-500"
    />
  );
}
function SaveBtn({ onClick, saving, saved }: { onClick: () => void; saving: boolean; saved: boolean }) {
  return (
    <button
      onClick={onClick} disabled={saving}
      className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-60
                 text-white text-sm px-4 py-1.5 rounded-lg transition"
    >
      {saving ? <RefreshCw size={13} className="animate-spin" /> :
       saved   ? <Check    size={13} /> : <Save size={13} />}
      {saved ? "Saved" : saving ? "Saving…" : "Save"}
    </button>
  );
}

// ── Tab definitions ───────────────────────────────────────────────────────────
const TABS = ["Weekly", "Monthly", "Notifications", "Telegram", "Broker", "F&O & Holidays"] as const;
type Tab = typeof TABS[number];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("Weekly");
  const [loading,   setLoading]   = useState(true);

  // ── Weekly config ──────────────────────────────────────────────────────────
  const [weeklyStocks, setWeeklyStocks] = useState<string[]>([]);
  const [eowEnabled,   setEowEnabled]   = useState(true);
  const [eowTime,      setEowTime]      = useState("15:10");
  const [eowEmail,     setEowEmail]     = useState(true);
  const [eowWA,        setEowWA]        = useState(true);
  const [eowSaving,    setEowSaving]    = useState(false);
  const [eowSaved,     setEowSaved]     = useState(false);

  // ── Monthly config ─────────────────────────────────────────────────────────
  const [monthlyStocks, setMonthlyStocks] = useState<string[]>([]);

  // ── Notification config ────────────────────────────────────────────────────
  const [smtpHost,    setSmtpHost]    = useState("smtp.gmail.com");
  const [smtpPort,    setSmtpPort]    = useState("587");
  const [smtpUser,    setSmtpUser]    = useState("");
  const [smtpPass,    setSmtpPass]    = useState("");
  const [smtpFrom,    setSmtpFrom]    = useState("Fyers Scanner");
  const [smtpTo,      setSmtpTo]      = useState("");  // comma-separated
  const [smtpSaving,  setSmtpSaving]  = useState(false);
  const [smtpSaved,   setSmtpSaved]   = useState(false);

  const [waPhone,     setWaPhone]     = useState("9677132280");
  const [waApiKey,    setWaApiKey]    = useState("");
  const [waSaving,    setWaSaving]    = useState(false);
  const [waSaved,     setWaSaved]     = useState(false);

  // ── Telegram config ────────────────────────────────────────────────────────
  const [tgEnabled,   setTgEnabled]   = useState(false);
  const [tgChatId,    setTgChatId]    = useState("");
  const [tgToken,     setTgToken]     = useState("");        // only sent if non-empty
  const [tgTokenSet,  setTgTokenSet]  = useState(false);
  const [tgTokenHint, setTgTokenHint] = useState("");
  const [tgSaving,    setTgSaving]    = useState(false);
  const [tgSaved,     setTgSaved]     = useState(false);
  const [tgTesting,   setTgTesting]   = useState(false);
  const [tgMsg,       setTgMsg]       = useState("");
  const [tgAutoSend,  setTgAutoSend]  = useState(false);
  const [tgRecency,   setTgRecency]   = useState("7");

  // ── F&O ───────────────────────────────────────────────────────────────────
  const [foCount,     setFoCount]     = useState<number | null>(null);
  const [foUpdated,   setFoUpdated]   = useState("");
  const [foRefreshing, setFoRefreshing] = useState(false);
  const [foMsg,       setFoMsg]       = useState("");

  // ── Load all config ────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      getConfig("weekly_stocks"),
      getConfig("monthly_stocks"),
      getConfig("eow_config"),
      getConfig("email_config"),
      getConfig("whatsapp_config"),
      getConfig("fo_stocks_updated"),
      getConfig("weekly_stocks"),
    ]).then(([w, m, eow, email, wa, foUpd]) => {
      setWeeklyStocks((w.value as string[]) ?? []);
      setMonthlyStocks((m.value as string[]) ?? []);
      setFoCount(((w.value as string[]) ?? []).length);
      setFoUpdated(String(foUpd.value ?? ""));

      const ec = eow.value as Record<string, unknown> ?? {};
      setEowEnabled(ec.enabled as boolean ?? true);
      setEowTime(String(ec.scan_time ?? "15:10"));
      setEowEmail(ec.notify_email as boolean ?? true);
      setEowWA(ec.notify_whatsapp as boolean ?? true);

      const em = email.value as Record<string, unknown> ?? {};
      setSmtpHost(String(em.smtp_host  ?? "smtp.gmail.com"));
      setSmtpPort(String(em.smtp_port  ?? "587"));
      setSmtpUser(String(em.username   ?? ""));
      setSmtpPass(String(em.password   ?? ""));
      setSmtpFrom(String(em.from_name  ?? "Fyers Scanner"));
      setSmtpTo(((em.to_addresses as string[]) ?? []).join(", "));

      const wa2 = wa.value as Record<string, unknown> ?? {};
      const recs = (wa2.recipients as Array<Record<string, string>>) ?? [];
      if (recs.length > 0) {
        setWaPhone(recs[0].phone ?? "9677132280");
        setWaApiKey(recs[0].apikey ?? "");
      }
    }).catch(console.error).finally(() => setLoading(false));

    // Telegram config loads from its own (token-masking) endpoint.
    getTelegramConfig().then(tg => {
      setTgEnabled(tg.enabled);
      setTgChatId(tg.chat_id);
      setTgTokenSet(tg.bot_token_set);
      setTgTokenHint(tg.bot_token_hint);
      setTgAutoSend(tg.auto_send_patterns);
      setTgRecency(String(tg.auto_send_recency_days ?? 7));
    }).catch(console.error);
  }, []);

  // ── Save handlers ──────────────────────────────────────────────────────────
  async function saveEow() {
    setEowSaving(true);
    try {
      await setConfig("eow_config", {
        enabled: eowEnabled, scan_time: eowTime,
        notify_email: eowEmail, notify_whatsapp: eowWA,
      });
      setEowSaved(true); setTimeout(() => setEowSaved(false), 2500);
    } finally { setEowSaving(false); }
  }

  async function saveEmail() {
    setSmtpSaving(true);
    try {
      const to_addresses = smtpTo.split(",").map(s => s.trim()).filter(Boolean);
      await setConfig("email_config", {
        smtp_host: smtpHost, smtp_port: parseInt(smtpPort),
        username: smtpUser, password: smtpPass,
        from_name: smtpFrom, to_addresses,
      });
      setSmtpSaved(true); setTimeout(() => setSmtpSaved(false), 2500);
    } finally { setSmtpSaving(false); }
  }

  async function saveWhatsApp() {
    setWaSaving(true);
    try {
      await setConfig("whatsapp_config", {
        recipients: [{ phone: waPhone, apikey: waApiKey }],
      });
      setWaSaved(true); setTimeout(() => setWaSaved(false), 2500);
    } finally { setWaSaving(false); }
  }

  async function saveTelegram() {
    setTgSaving(true);
    setTgMsg("");
    try {
      const res = await saveTelegramConfig({
        enabled: tgEnabled,
        chat_id: tgChatId.trim(),
        auto_send_patterns: tgAutoSend,
        auto_send_recency_days: Math.max(1, parseInt(tgRecency || "7", 10) || 7),
        // Only send the token if the user typed a new one; blank keeps the stored one.
        ...(tgToken.trim() ? { bot_token: tgToken.trim() } : {}),
      });
      setTgTokenSet(res.bot_token_set);
      setTgToken("");  // clear the input after saving the secret
      setTgSaved(true); setTimeout(() => setTgSaved(false), 2500);
    } catch (e: unknown) {
      setTgMsg(`Error: ${e instanceof Error ? e.message : "Save failed"}`);
    } finally { setTgSaving(false); }
  }

  async function handleTgTest() {
    setTgTesting(true);
    setTgMsg("");
    try {
      await testTelegram();
      setTgMsg("✓ Test message sent — check your Telegram.");
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : "Test failed";
      setTgMsg(`Error: ${m.replace(/^API \d+:\s*/, "")}`);
    } finally { setTgTesting(false); }
  }

  async function handleFoRefresh() {
    setFoRefreshing(true); setFoMsg("");
    try {
      const res = await refreshFoStocks();
      setFoCount(res.count);
      setFoUpdated(res.updated);
      setFoMsg(`Updated: ${res.count} stocks fetched from NSE`);
    } catch (e: unknown) {
      setFoMsg(`Error: ${e instanceof Error ? e.message : "Failed"}`);
    } finally { setFoRefreshing(false); }
  }

  if (loading) return <div className="text-gray-400 p-8">Loading…</div>;

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 text-sm py-2 px-3 rounded-lg font-medium transition
              ${activeTab === tab
                ? "bg-brand-600 text-white"
                : "text-gray-400 hover:text-white hover:bg-gray-800"}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Weekly tab ─────────────────────────────────────────────────────── */}
      {activeTab === "Weekly" && (
        <div className="space-y-5">
          <StockListEditor configKey="weekly_stocks" label="Weekly Stock List" initialStocks={weeklyStocks} />

          <Card title="End-of-Week (EOW) Auto Scan">
            <div className="flex items-center gap-3">
              <input type="checkbox" id="eow-enabled" checked={eowEnabled}
                onChange={e => setEowEnabled(e.target.checked)}
                className="w-4 h-4 accent-brand-600 cursor-pointer" />
              <label htmlFor="eow-enabled" className="text-sm text-gray-300 cursor-pointer">
                Enable automatic EOW scan on last trading day of week
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Scan Time (IST, 24h format)</Label>
                <Input value={eowTime} onChange={setEowTime} placeholder="15:10" />
                <p className="text-xs text-gray-600 mt-1">Market closes 15:30. Scan runs at this time.</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notifications on match</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={eowEmail} onChange={e => setEowEmail(e.target.checked)}
                    className="accent-brand-600" />
                  Send Email
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={eowWA} onChange={e => setEowWA(e.target.checked)}
                    className="accent-brand-600" />
                  Send WhatsApp
                </label>
              </div>
            </div>

            <SaveBtn onClick={saveEow} saving={eowSaving} saved={eowSaved} />
          </Card>
        </div>
      )}

      {/* ── Monthly tab ─────────────────────────────────────────────────────── */}
      {activeTab === "Monthly" && (
        <StockListEditor configKey="monthly_stocks" label="Monthly Stock List" initialStocks={monthlyStocks} />
      )}

      {/* ── Notifications tab ──────────────────────────────────────────────── */}
      {activeTab === "Notifications" && (
        <div className="space-y-5">
          <Card title="Gmail SMTP">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>SMTP Host</Label>
                <Input value={smtpHost} onChange={setSmtpHost} placeholder="smtp.gmail.com" />
              </div>
              <div>
                <Label>SMTP Port</Label>
                <Input value={smtpPort} onChange={setSmtpPort} placeholder="587" />
              </div>
              <div>
                <Label>Gmail Address</Label>
                <Input value={smtpUser} onChange={setSmtpUser} type="email" placeholder="you@gmail.com" />
              </div>
              <div>
                <Label>App Password</Label>
                <Input value={smtpPass} onChange={setSmtpPass} type="password" placeholder="••••••••••••••••" />
                <p className="text-xs text-gray-600 mt-1">
                  Generate at myaccount.google.com → Security → App passwords
                </p>
              </div>
              <div>
                <Label>From Name</Label>
                <Input value={smtpFrom} onChange={setSmtpFrom} placeholder="Fyers Scanner" />
              </div>
              <div>
                <Label>To Addresses (comma separated)</Label>
                <Input value={smtpTo} onChange={setSmtpTo} placeholder="a@gmail.com, b@gmail.com" />
              </div>
            </div>
            <SaveBtn onClick={saveEmail} saving={smtpSaving} saved={smtpSaved} />
          </Card>

          <Card title="WhatsApp (CallMeBot)">
            <div className="bg-blue-950/30 border border-blue-800 rounded-lg px-4 py-3 text-xs text-blue-300 space-y-1">
              <p className="font-semibold">One-time setup required per number:</p>
              <ol className="list-decimal ml-4 space-y-1">
                <li>Save <span className="font-mono">+34 644 60 49 16</span> in your contacts as "CallMeBot"</li>
                <li>Send <span className="font-mono">I allow callmebot to send me messages</span> to that number on WhatsApp</li>
                <li>You'll receive an API key — enter it below</li>
              </ol>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>WhatsApp Number (with country code, no +)</Label>
                <Input value={waPhone} onChange={setWaPhone} placeholder="919677132280" />
              </div>
              <div>
                <Label>CallMeBot API Key</Label>
                <Input value={waApiKey} onChange={setWaApiKey} placeholder="123456" />
              </div>
            </div>
            <SaveBtn onClick={saveWhatsApp} saving={waSaving} saved={waSaved} />
          </Card>
        </div>
      )}

      {/* ── Telegram tab ───────────────────────────────────────────────────── */}
      {activeTab === "Telegram" && (
        <div className="space-y-5">
          <Card title="Telegram Bot">
            <div className="bg-blue-950/30 border border-blue-800 rounded-lg px-4 py-3 text-xs text-blue-300 space-y-1">
              <p className="font-semibold">One-time setup:</p>
              <ol className="list-decimal ml-4 space-y-1">
                <li>In Telegram, open <span className="font-mono">@BotFather</span> → send <span className="font-mono">/newbot</span> → follow prompts → copy the <b>bot token</b>.</li>
                <li>Send any message to your new bot (so it can message you back).</li>
                <li>Get your <b>chat ID</b>: open <span className="font-mono">@userinfobot</span> and it replies with your numeric ID. (For a group, add the bot to the group and use the group's ID.)</li>
                <li>Paste both below, Save, then hit <b>Send test</b>.</li>
              </ol>
            </div>

            <div className="flex items-center gap-3">
              <input type="checkbox" id="tg-enabled" checked={tgEnabled}
                onChange={e => setTgEnabled(e.target.checked)}
                className="w-4 h-4 accent-brand-600 cursor-pointer" />
              <label htmlFor="tg-enabled" className="text-sm text-gray-300 cursor-pointer">
                Enable Telegram sending
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <Label>Bot Token {tgTokenSet && <span className="text-green-400">(saved: {tgTokenHint})</span>}</Label>
                <Input value={tgToken} onChange={setTgToken} type="password"
                  placeholder={tgTokenSet ? "•••••••• (leave blank to keep)" : "123456:ABC-DEF…"} />
              </div>
              <div>
                <Label>Chat ID</Label>
                <Input value={tgChatId} onChange={setTgChatId} placeholder="e.g. 123456789" />
              </div>
            </div>

            {/* Auto-send freshly-formed patterns */}
            <div className="border-t border-gray-800 pt-3 space-y-2">
              <div className="flex items-center gap-3">
                <input type="checkbox" id="tg-autosend" checked={tgAutoSend}
                  onChange={e => setTgAutoSend(e.target.checked)}
                  className="w-4 h-4 accent-brand-600 cursor-pointer" />
                <label htmlFor="tg-autosend" className="text-sm text-gray-300 cursor-pointer">
                  Auto-send newly-formed chart patterns when a scan runs
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Label>Only patterns formed within the last</Label>
                <input type="number" min={1} value={tgRecency}
                  onChange={e => setTgRecency(e.target.value)}
                  className="w-16 bg-gray-800 text-white text-sm rounded-lg px-2 py-1 border border-gray-700" />
                <span className="text-xs text-gray-400">days (older historical matches are never auto-sent)</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <SaveBtn onClick={saveTelegram} saving={tgSaving} saved={tgSaved} />
              <button
                onClick={handleTgTest}
                disabled={tgTesting || !tgTokenSet || !tgChatId.trim()}
                className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50
                           text-white text-sm px-4 py-1.5 rounded-lg transition"
                title={!tgTokenSet || !tgChatId.trim() ? "Save token + chat id first" : "Send a test message"}
              >
                {tgTesting ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
                {tgTesting ? "Sending…" : "Send test"}
              </button>
            </div>

            {tgMsg && (
              <div className={`text-sm px-3 py-2 rounded-lg ${tgMsg.startsWith("Error") ? "bg-red-950/40 text-red-300" : "bg-green-950/40 text-green-300"}`}>
                {tgMsg}
              </div>
            )}

            <p className="text-xs text-gray-600">
              Used by the "Send to Telegram" buttons on the analysis / trades / patterns pages, and (if enabled above)
              auto-alerts when a pattern scan finds freshly-formed setups.
            </p>
          </Card>
        </div>
      )}

      {/* ── Broker tab ─────────────────────────────────────────────────────── */}
      {activeTab === "Broker" && (
        <div className="space-y-5">
          <FyersConnectionCard />
        </div>
      )}

      {/* ── F&O & Holidays tab ─────────────────────────────────────────────── */}
      {activeTab === "F&O & Holidays" && (
        <div className="space-y-5">
          <Card title="F&O Stock List">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-300">
                  {foCount != null ? `${foCount} stocks currently configured` : "—"}
                </p>
                {foUpdated && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Last updated: {new Date(foUpdated).toLocaleString("en-IN")}
                  </p>
                )}
              </div>
              <button
                onClick={handleFoRefresh}
                disabled={foRefreshing}
                className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-60
                           text-white text-sm px-4 py-2 rounded-lg transition"
              >
                {foRefreshing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {foRefreshing ? "Fetching…" : "Refresh from NSE"}
              </button>
            </div>
            {foMsg && (
              <div className={`text-sm px-3 py-2 rounded-lg ${foMsg.startsWith("Error") ? "bg-red-950/40 text-red-300" : "bg-green-950/40 text-green-300"}`}>
                {foMsg}
              </div>
            )}
            <p className="text-xs text-gray-600">
              Refreshing will update both Weekly and Monthly stock lists with the latest NSE F&O eligible stocks.
            </p>
          </Card>

          <Card title="NSE Holidays">
            <p className="text-sm text-gray-400">
              Manage NSE trading holidays on the{" "}
              <a href="/dashboard/holidays" className="text-brand-400 hover:underline">Holidays page →</a>
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
