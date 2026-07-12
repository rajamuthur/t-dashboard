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

export interface EmaRow {
  symbol: string; signal: "BULL" | "BEAR"; cross_date: string; days_since: number;
  close: number; ema50: number; ema200: number; gap_pct: number;
  price_vs_ema200_pct: number; coiling: boolean; coiled_bars: number;
}
export interface EmaResult {
  rows: EmaRow[]; at: string | null;
  params: { universe?: string; timeframe?: string; cross_window?: number; near_pct?: number; near_bars?: number };
  counts: { bull?: number; bear?: number; coiling?: number; scanned?: number };
}
export interface EmaStatus {
  status?: string; step?: string; current?: string; done?: number; pending?: number; total?: number;
  bull?: number; bear?: number; coiling?: number; scanned?: number; matches?: number;
  message?: string; universe?: string; timeframe?: string; at?: string;
}
export interface Universe { key: string; label: string; count: number; }
export interface EmaChart { candles: any[]; shapes: any[]; focus_date: string | null; }

export const runEmaScan = (p: { universe: string; timeframe: string; crossWindow: number; nearPct: number; nearBars: number }) =>
  call<{ status: string }>(
    `/ema/scan?universe=${encodeURIComponent(p.universe)}&timeframe=${p.timeframe}` +
    `&cross_window=${p.crossWindow}&near_pct=${p.nearPct}&near_bars=${p.nearBars}`,
    { method: "POST" },
  );
export const getEmaStatus = () => call<EmaStatus>("/ema/status");
export const getEmaResult = () => call<EmaResult>("/ema/result");
export const getEmaUniverses = () => call<Universe[]>("/ema/universes");
export const getEmaChart = (symbol: string, timeframe = "day") =>
  call<EmaChart>(`/ema/chart?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`);
