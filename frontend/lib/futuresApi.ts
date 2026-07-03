import { getToken, clearToken } from "./auth";

const BASE = "/api/backend";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string>) },
  });
  if (res.status === 401) { clearToken(); if (typeof window !== "undefined") window.location.href = "/login"; throw new Error("Unauthorized"); }
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : await res.json();
}

export interface FutContract {
  month: string; symbol: string; expiry: string; price: number | null; premium: number | null;
  vs_spot: "RICH" | "CHEAP" | null; curve: "ABOVE" | "BELOW" | null; action: "BUY" | "SHORT" | null; focus: boolean;
}
export interface FutRow { underlying: string; spot: number; contracts: FutContract[]; flagged: boolean; }
export interface FutResult { rows: FutRow[]; at: string | null; params: { threshold?: number; curve_tol?: number; months?: number }; }
export interface FutStatus {
  status?: string; step?: string; current?: string; done?: number; total?: number;
  scanned?: number; flagged?: number; new_alerts?: number; message?: string; token?: boolean; at?: string;
}
export interface FutMatch { id: number; ts: string; day: string; underlying: string; month: string; action: string; kind: string; spot: number; future: number; premium: number; }
export interface FutChart { candles: any[]; shapes: any[]; focus_date: string | null; }

export const runFuturesScan = (threshold: number, curveTol: number, alert = true) =>
  call<{ status: string }>(`/futures/scan?threshold=${threshold}&curve_tol=${curveTol}&alert=${alert}`, { method: "POST" });
export const getFuturesStatus = () => call<FutStatus>("/futures/status");
export const getFuturesResult = () => call<FutResult>("/futures/result");
export const getFuturesHistory = (limit = 100) => call<FutMatch[]>(`/futures/history?limit=${limit}`);
export const getFuturesChart = (symbol: string) => call<FutChart>(`/futures/chart?symbol=${encodeURIComponent(symbol)}`);
