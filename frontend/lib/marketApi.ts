import { getToken, clearToken } from "./auth";

const BASE = "/api/backend";

async function call<T>(path: string): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 401 || res.status === 403) {
    clearToken();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

export interface IndexQuote {
  name: string;
  symbol: string;
  lp: number | null;
  ch: number | null;   // points change
  chp: number | null;  // % change
}
export interface IndicesResponse {
  indices: IndexQuote[];
  market_open: boolean;
  reason: string;
}

export const getIndices = () => call<IndicesResponse>("/market/indices");
