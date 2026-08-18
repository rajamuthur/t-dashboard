import { getToken, clearToken } from "./auth";

const BASE = "/api/backend";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string>),
    },
  });
  if (res.status === 401 || res.status === 403) {
    clearToken();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export interface PnlConfig {
  enabled: boolean;
  profit_threshold: number;
  profit_interval_min: number;
  loss_threshold: number;
  loss_interval_min: number;
  base_check_min: number;
  eod_time: string;          // "HH:MM"
  expiry_trading_days: number;
  spike_enabled: boolean;
  spike_pct: number;
  spike_window_min: number;
  market_open_enabled: boolean;
  market_open_time: string;   // "HH:MM"
}

export interface PnlNotification {
  id: number;
  trade_id: number | null;
  symbol: string | null;
  mode: string | null;
  kind: "profit" | "loss" | "expiry" | "eod";
  triggered_at: string;
  pnl: number | null;
  pnl_pct: number | null;
  price: number | null;
  message: string | null;
  delivered: number;
  error: string | null;
}

export const getPnlConfig = () => call<PnlConfig>("/pnl/config");

export const setPnlConfig = (patch: Partial<PnlConfig>) =>
  call<PnlConfig>("/pnl/config", { method: "PATCH", body: JSON.stringify(patch) });

export const getPnlNotifications = (limit = 100) =>
  call<PnlNotification[]>(`/pnl/notifications?limit=${limit}`);

export const runEodSummary = () =>
  call<{ positions: number; delivered: boolean; charts?: number; expiring?: number; skipped?: string }>(
    "/pnl/run-eod", { method: "POST" },
  );

export const runOpenBrief = () =>
  call<{ positions: number; delivered: boolean; skipped?: string }>(
    "/pnl/run-open", { method: "POST" },
  );
