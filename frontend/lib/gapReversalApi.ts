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

export interface GrConfig {
  ema_length: number; ema_source: string;
  rsi_length: number; rsi_ma_length: number;
  band_upper: number; band_middle: number; band_lower: number;
  gap_pct: number; rr_targets: number[]; max_hold_bars: number;
  universe: string; timeframe: string; direction: "both" | "bull" | "bear";
}
export interface Universe { key: string; label: string; count: number; }

export interface GrSetup {
  symbol: string; signal: "BULL" | "BEAR"; gap_date: string; gap_pct: number;
  rsi_ema: number; entry: number; stop: number; risk: number; risk_pct: number | null;
  targets: Record<string, number>; close: number; ema: number; entry_note?: string;
}
export interface GrScanResult { rows: GrSetup[]; at: string | null; counts: { bull: number; bear: number; scanned: number }; }

export interface GrExitStat { signals: number; wins: number; losses: number; timeouts: number; win_rate: number; total_R: number; avg_R: number; }
export interface GrBacktest {
  at: string; total_signals: number; scanned: number;
  by_exit: Record<string, GrExitStat>;
  by_direction: { BULL: Record<string, GrExitStat>; BEAR: Record<string, GrExitStat> };
  per_stock: { symbol: string; signals: number; total_R: Record<string, number> }[];
  samples: any[];
  params: GrConfig;
}

export interface GrChart {
  candles: any[]; shapes: any[]; focus_date: string | null;
  rsi: { date: string; rsi: number | null; rsi_ma: number | null }[];
  bands?: { upper: number; middle: number; lower: number };
}

export const getGrConfig = () => call<GrConfig>("/gap-reversal/config");
export const setGrConfig = (patch: Partial<GrConfig>) =>
  call<GrConfig>("/gap-reversal/config", { method: "PATCH", body: JSON.stringify(patch) });
export const getGrUniverses = () => call<Universe[]>("/gap-reversal/universes");

export const runGrScan = () => call<GrScanResult>("/gap-reversal/scan", { method: "POST" });
export const getGrScanResult = () => call<GrScanResult>("/gap-reversal/scan");

export const runGrBacktest = () => call<GrBacktest>("/gap-reversal/backtest", { method: "POST" });
export const getGrBacktestResult = () => call<GrBacktest>("/gap-reversal/backtest");

export const getGrChart = (symbol: string) =>
  call<GrChart>(`/gap-reversal/chart?symbol=${encodeURIComponent(symbol)}`);
