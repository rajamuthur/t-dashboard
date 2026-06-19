"use client";
import { useEffect, useState } from "react";
import { getFyersStatus, FyersStatus } from "@/lib/fyersApi";

function fmtRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function FyersTokenBadge() {
  const [st, setSt] = useState<FyersStatus | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const load = () => getFyersStatus().then(setSt).catch(() => setSt({ connected: false, message: "status unreachable" }));
    load();
    const a = setInterval(load, 60_000);       // re-check token every minute
    const b = setInterval(() => setNow(Date.now()), 30_000);  // tick the countdown
    return () => { clearInterval(a); clearInterval(b); };
  }, []);

  const expMs = st?.expires_at ? st.expires_at * 1000 : null;
  const remain = expMs != null ? expMs - now : null;
  const expired = !st?.connected || (remain != null && remain <= 0);
  const soon = !expired && remain != null && remain < 3_600_000;
  const color = expired ? "bg-red-500" : soon ? "bg-amber-400" : "bg-green-500";
  const label = expired ? "Token expired" : soon ? "Token expiring soon" : "Token active";
  const expWhen = expMs ? new Date(expMs).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }) : null;

  return (
    <div className="relative group flex items-center" title="">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${color} ${expired ? "" : "animate-pulse"}`} />
      <div className="pointer-events-none absolute left-0 top-6 z-50 hidden group-hover:block w-64 p-3 rounded-lg
                      bg-gray-800 border border-gray-700 text-[11px] leading-relaxed text-gray-300 shadow-xl">
        <div className={`font-semibold ${expired ? "text-red-300" : soon ? "text-amber-300" : "text-green-300"}`}>
          Fyers — {label}
        </div>
        <div className="mt-1 text-gray-400">{st?.message ?? "Checking…"}</div>
        {!expired && remain != null && (
          <div className="mt-1">Expires in <b className="text-white">{fmtRemaining(remain)}</b>{expWhen ? ` (~${expWhen})` : ""}</div>
        )}
        {expired ? (
          <div className="mt-2 text-amber-300">Re-auth needed → Settings → Broker → “Login now”, or it auto-fixes at the 8:15 AM job.</div>
        ) : (
          <div className="mt-2 text-gray-400">Auto-login mints a fresh token daily at 8:15 AM. A manual login (Settings → Broker) is only needed if the auto-login fails.</div>
        )}
      </div>
    </div>
  );
}
