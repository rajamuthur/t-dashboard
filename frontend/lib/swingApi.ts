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
export interface SwingStatus { status?: string; step?: string; run_id?: number; total?: number; message?: string; overall?: SwingOverall; }
export interface SwingSignal { symbol: string; entry: number; date: string; upper: number; stop: number; }

export const runSwingBacktest = (timeframe: SwingTf, lookback: number) =>
  call<{ status: string }>(`/swing/backtest?timeframe=${timeframe}&lookback=${lookback}`, { method: "POST" });
export const getSwingStatus = () => call<SwingStatus>("/swing/status");
export const getSwingRun = (id: number) => call<{ result: SwingResult }>(`/swing/runs/${id}`);
export const getSwingCurrent = (timeframe: SwingTf, lookback: number) =>
  call<SwingSignal[]>(`/swing/current?timeframe=${timeframe}&lookback=${lookback}`);
