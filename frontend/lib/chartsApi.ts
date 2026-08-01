import { getToken, clearToken } from "./auth";

const BASE = "/api/backend";

async function call<T>(path: string): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status === 401 || res.status === 403) { clearToken(); if (typeof window !== "undefined") window.location.href = "/login"; throw new Error("Unauthorized"); }
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export interface ChartUniverse { key: string; label: string; count: number; }
export interface ChartQuote { lp: number; chp: number; ch: number; name?: string; }

export const getChartUniverses = () => call<ChartUniverse[]>("/charts/universes");
export const getUniverseSymbols = (key: string) =>
  call<{ key: string; symbols: string[] }>(`/charts/universe/${key}`).then(r => r.symbols);
export const getChartQuotes = (symbols: string[]) =>
  symbols.length === 0 ? Promise.resolve({} as Record<string, ChartQuote>)
    : call<Record<string, ChartQuote>>(`/charts/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
