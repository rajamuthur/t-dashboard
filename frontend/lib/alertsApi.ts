import { getToken, clearToken } from "./auth";

const BASE = "/api/backend";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string>) },
  });
  if (res.status === 401 || res.status === 403) { clearToken(); if (typeof window !== "undefined") window.location.href = "/login"; throw new Error("Unauthorized"); }
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : await res.json();
}

export type AlertKind = "horizontal" | "trend";
export type AlertCond = "cross_up" | "cross_down";
export type AlertRepeat = "once" | "recurring";
export type AlertStatus = "active" | "triggered" | "disabled";

export interface AlertRow {
  id: number; symbol: string; name: string | null; timeframe: string;
  kind: AlertKind; condition: AlertCond; repeat_mode: AlertRepeat;
  price: number | null; t1: number | null; p1: number | null; t2: number | null; p2: number | null;
  note: string | null; status: AlertStatus; last_diff: number | null;
  created_at: string; triggered_at: string | null; line_now: number | null;
}
export interface AlertSymbol { symbol: string; total: number; active: number; }
export interface AlertNotification {
  id: number; alert_id: number; symbol: string; triggered_at: string;
  price: number; line_value: number; direction: string; message: string;
  delivered: number; error: string | null;
}
export interface AlertChartResp { candles: any[]; }

export interface CreateAlertBody {
  symbol: string; name?: string; timeframe: string; kind: AlertKind; condition: AlertCond;
  repeat_mode: AlertRepeat; price?: number; t1?: number; p1?: number; t2?: number; p2?: number; note?: string;
}
export type PatchAlertBody = Partial<{
  name: string; condition: AlertCond; repeat_mode: AlertRepeat;
  price: number; t1: number; p1: number; t2: number; p2: number; note: string; status: AlertStatus;
}>;

export const listAlerts = (symbol?: string, status?: string) => {
  const qs = new URLSearchParams();
  if (symbol) qs.set("symbol", symbol);
  if (status) qs.set("status", status);
  const s = qs.toString();
  return call<AlertRow[]>(`/alerts${s ? `?${s}` : ""}`);
};
export const getAlertSymbols = () => call<AlertSymbol[]>("/alerts/symbols");
export const createAlert = (body: CreateAlertBody) => call<AlertRow>("/alerts", { method: "POST", body: JSON.stringify(body) });
export const updateAlert = (id: number, body: PatchAlertBody) => call<AlertRow>(`/alerts/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteAlert = (id: number) => call<void>(`/alerts/${id}`, { method: "DELETE" });
export const getAlertNotifications = (alertId?: number, limit = 100) =>
  call<AlertNotification[]>(`/alerts/notifications?${alertId != null ? `alert_id=${alertId}&` : ""}limit=${limit}`);
export const getAlertConfig = () => call<{ check_minutes: number }>("/alerts/config");
export const setAlertConfig = (minutes: number) => call<{ check_minutes: number }>("/alerts/config", { method: "PATCH", body: JSON.stringify({ minutes }) });
export const getAlertChart = (symbol: string, timeframe: string) =>
  call<AlertChartResp>(`/alerts/chart?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`);
