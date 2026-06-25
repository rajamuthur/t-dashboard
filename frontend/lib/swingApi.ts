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

export type SwingTf = "day" | "week" | "month";

export interface SwingOverall {
  trades: number; wins: number; win_rate: number; expectancy: number;
  net_pct: number; avg_win: number; avg_loss: number; max_dd: number; avg_bars: number; open: number;
}
export interface SwingPerSymbol extends SwingOverall { symbol: string; }
export interface SwingTrade {
  symbol?: string; entry_date: string; entry: number; exit_date: string; exit: number;
  pnl_pct: number; bars_held: number; outcome: string;
}
export interface SwingResult {
  overall: SwingOverall; per_symbol: SwingPerSymbol[];
  equity_curve: { date: string; cum_pct: number }[]; trades: SwingTrade[]; symbols_with_trades: number;
}
export interface SwingStatus {
  status?: string; step?: string; run_id?: number; message?: string; overall?: SwingOverall;
  current?: string; done?: number; pending?: number; total?: number;
}
export interface SwingSignal { symbol: string; entry: number; date: string; upper: number; stop: number; }
export interface SwingRunMeta { id: number; timeframe: SwingTf; lookback: number; universe: string; created_at: string; }
export interface SwingChart {
  candles: { date: string; open: number; high: number; low: number; close: number; volume: number }[];
  shapes: any[]; focus_date: string | null;
}

export const runSwingBacktest = (timeframe: SwingTf, lookback: number, universe = "nifty500") =>
  call<{ status: string }>(`/swing/backtest?timeframe=${timeframe}&lookback=${lookback}&universe=${universe}`, { method: "POST" });
export const getSwingStatus = () => call<SwingStatus>("/swing/status");
export const getSwingRun = (id: number) => call<{ result: SwingResult } & SwingRunMeta>(`/swing/runs/${id}`);
export const getSwingRuns = () => call<SwingRunMeta[]>("/swing/runs?limit=1");
export const getSwingCurrent = (timeframe: SwingTf, lookback: number, universe = "nifty500") =>
  call<SwingSignal[]>(`/swing/current?timeframe=${timeframe}&lookback=${lookback}&universe=${universe}`);
export const getSwingChart = (symbol: string, timeframe: SwingTf, lookback: number) =>
  call<SwingChart>(`/swing/chart?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&lookback=${lookback}`);
