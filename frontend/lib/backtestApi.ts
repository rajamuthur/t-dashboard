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
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface StrategyInfo { key: string; label: string; description: string; }
export interface Universe { key: string; label: string; count: number; }

export interface BacktestStats {
  trades: number; wins: number; win_rate: number; expectancy: number;
  net_pct: number; avg_win: number; avg_loss: number; max_dd: number; days: number;
}
export interface SymbolStat extends BacktestStats { symbol: string; }
export interface BacktestTrade {
  symbol: string; date: string; side: string; entry: number; exit: number;
  stop: number; target: number; outcome: string; pnl_pct: number; reason: string;
  entry_time: string; exit_time: string;
}
export interface BacktestResult {
  overall: BacktestStats;
  per_symbol: SymbolStat[];
  equity_curve: { date: string; cum_pct: number }[];
  trades: BacktestTrade[];
  symbols_with_trades: number;
}
export interface BacktestRun {
  id: number; strategy: string; universe: string; from_date: string | null;
  to_date: string | null; cost_pct: number; created_at: string;
  overall?: BacktestStats | null; result?: BacktestResult | null;
}
export interface BacktestStatus {
  status?: "running" | "completed" | "failed";
  step?: string; total?: number; strategy?: string; universe?: string;
  run_id?: number; overall?: BacktestStats; message?: string;
}

export const getStrategies = () => call<StrategyInfo[]>("/backtest/strategies");
export const getBacktestUniverses = () => call<Universe[]>("/backtest/universes");
export const getBacktestStatus = () => call<BacktestStatus>("/backtest/status");
export const getBacktestRuns = () => call<BacktestRun[]>("/backtest/runs");
export const getBacktestRun = (id: number) => call<BacktestRun>(`/backtest/runs/${id}`);

export const runBacktest = (p: {
  strategy: string; universe: string; from_date?: string; to_date?: string; cost_pct: number;
}) => {
  const q = new URLSearchParams();
  q.set("strategy", p.strategy); q.set("universe", p.universe); q.set("cost_pct", String(p.cost_pct));
  if (p.from_date) q.set("from_date", p.from_date);
  if (p.to_date) q.set("to_date", p.to_date);
  return call<{ status: string }>(`/backtest/run?${q.toString()}`, { method: "POST" });
};
