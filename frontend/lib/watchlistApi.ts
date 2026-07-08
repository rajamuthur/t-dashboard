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

export interface Watchlist { id: number; name: string; sort_order: number; item_count: number; }
export interface WatchItem {
  id: number; symbol: string; label: string | null; sort_order: number;
  lp?: number | null; chp?: number | null; ch?: number | null;
}

export const getWatchlists = () => call<Watchlist[]>("/watchlists");
export const createWatchlist = (name: string) =>
  call<Watchlist>("/watchlists", { method: "POST", body: JSON.stringify({ name }) });
export const renameWatchlist = (id: number, name: string) =>
  call<{ id: number; name: string }>(`/watchlists/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
export const deleteWatchlist = (id: number) =>
  call<void>(`/watchlists/${id}`, { method: "DELETE" });

export const getItems = (wlId: number) => call<WatchItem[]>(`/watchlists/${wlId}/items`);
export const addItem = (wlId: number, body: { symbol?: string; underlying?: string; expiry?: string }) =>
  call<WatchItem>(`/watchlists/${wlId}/items`, { method: "POST", body: JSON.stringify(body) });
export const deleteItem = (wlId: number, itemId: number) =>
  call<void>(`/watchlists/${wlId}/items/${itemId}`, { method: "DELETE" });
