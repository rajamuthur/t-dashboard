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

export type InstrumentType = "equity" | "future" | "option";
export type Side = "buy" | "sell";
export type OptionType = "CE" | "PE";

export interface Trade {
  id: number;
  instrument_type: InstrumentType;
  underlying: string;
  symbol: string;
  side: Side;
  option_type: OptionType | null;
  strike: number | null;
  expiry_date: string | null;
  lot_size: number;
  num_lots: number;
  entry_price: number;
  entry_at: string;
  exit_price: number | null;
  exit_at: string | null;
  current_price: number | null;
  current_at: string | null;
  status: "open" | "closed";
  notes: string | null;
  created_at: string;
  // computed by backend on every response
  pnl: number;
  pnl_pct: number;
  ref_price: number;
  qty: number;
}

export interface NewTradePayload {
  instrument_type: InstrumentType;
  underlying: string;
  side: Side;
  option_type?: OptionType;
  strike?: number;
  expiry_date?: string;
  lot_size?: number;
  num_lots: number;
  entry_price: number;
  entry_at?: string;      // YYYY-MM-DD or full ISO; backend defaults to now()
  notes?: string;
}

export interface TradeDashboard {
  open_count: number;
  closed_count: number;
  total_count: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  win_rate: number | null;
  wins: number;
  losses: number;
  by_instrument_type: Record<InstrumentType, {
    open: number; closed: number; realized_pnl: number; unrealized_pnl: number;
  }>;
}

export interface TradeCatalog {
  indices: Array<{ key: string; lot_size: number; yahoo: string; label: string; weekly: boolean }>;
  stocks: string[];
}

export const getCatalog = () => call<TradeCatalog>("/trades/catalog");
export const getLotSize = (u: string) =>
  call<{ underlying: string; lot_size: number | null }>(`/trades/lot-size?underlying=${encodeURIComponent(u)}`);
export const getExpiries = (u: string) =>
  call<{ underlying: string; weekly: string[]; monthly: string[] }>(`/trades/expiries?underlying=${encodeURIComponent(u)}`);

export const listTrades = (status?: "open" | "closed") =>
  call<Trade[]>(`/trades${status ? `?status=${status}` : ""}`);
export const getDashboard = () => call<TradeDashboard>("/trades/dashboard");
export const createTrade = (payload: NewTradePayload) =>
  call<Trade>("/trades", { method: "POST", body: JSON.stringify(payload) });
export const patchTrade = (id: number, body: Partial<{
  entry_price: number; entry_at: string;
  exit_price: number; exit_at: string;
  current_price: number; status: "open" | "closed";
  notes: string; num_lots: number; lot_size: number;
}>) => call<Trade>(`/trades/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteTrade = (id: number) =>
  call<void>(`/trades/${id}`, { method: "DELETE" });
export const refreshOne = (id: number) =>
  call<Trade>(`/trades/${id}/refresh-price`, { method: "POST" });
export const refreshAll = () =>
  call<{ refreshed: number; skipped: number }>("/trades/refresh-all", { method: "POST" });
