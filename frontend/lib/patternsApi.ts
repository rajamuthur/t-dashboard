import { getToken, clearToken } from "./auth";
import type { PatternCandle, PatternShape } from "@/components/PatternShapeChart";

const BASE = "/api/backend";

async function call<T>(path: string, init: RequestInit = {}): Promise<{ data: T; total: number }> {
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
  const total = parseInt(res.headers.get("X-Total-Count") || "0", 10);
  const data = (res.status === 204 ? undefined : await res.json()) as T;
  return { data, total };
}

export type Timeframe = "day" | "week" | "month" | "5m" | "15m" | "30m" | "1h" | "4h";

export interface PatternType { key: string; label: string; window: number; }

export interface PatternRow {
  id: number;
  symbol: string;
  analysis_type: string;
  pattern_label: string;
  timeframe: string;
  candle_date: string;
  direction: string | null;
  entry: number | null;
  exit: number | null;
  pnl_pct: number | null;
  outcome: string | null;
  outcome_date: string | null;
  details: Record<string, any> | null;
}

export interface PatternDetail {
  signal: PatternRow;
  candles: PatternCandle[];
  shapes: PatternShape[];
  entry_close: number | null;
  stop_loss: number | null;
  target: number | null;
  direction: string | null;
}

export interface ScanStatus {
  status?: "running" | "completed" | "failed";
  step?: string; matched?: number; total?: number;
  analysis_type?: string; timeframe?: string; message?: string;
}

export const getPatternTypes = () =>
  call<PatternType[]>("/patterns/types").then(r => r.data);

export const runPatternScan = (analysisType: string, timeframe: Timeframe) =>
  call<{ status: string }>(`/patterns/run?analysis_type=${analysisType}&timeframe=${timeframe}`, { method: "POST" }).then(r => r.data);

export const getPatternScanStatus = () =>
  call<ScanStatus>("/patterns/status").then(r => r.data);

export const listPatterns = (params: {
  analysis_type?: string; timeframe: Timeframe; outcome?: string; symbol_filter?: string;
  sort_by?: string; sort_dir?: "asc" | "desc"; limit?: number; offset?: number;
}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "") q.set(k, String(v)); });
  return call<PatternRow[]>(`/patterns?${q.toString()}`);  // returns { data, total }
};

export interface PatternStats {
  success: number; failure: number; open: number; no_trade: number;
  total: number; win_rate: number | null;
}
export const getPatternStats = (params: { analysis_type?: string; timeframe: Timeframe; symbol_filter?: string }) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "") q.set(k, String(v)); });
  return call<PatternStats>(`/patterns/stats?${q.toString()}`).then(r => r.data);
};

export const getPatternDetail = (id: number) =>
  call<PatternDetail>(`/patterns/${id}/detail`).then(r => r.data);

export const sendPatternCharts = (ids: number[], title?: string) =>
  call<{ ok: boolean; sent: number; failed: number }>(`/patterns/send-charts`, {
    method: "POST", body: JSON.stringify({ ids, title }),
  }).then(r => r.data);

// Reuse the Telegram sender (kind "scans" — pattern rows are scan_results).
export { sendToTelegram } from "./telegramApi";
