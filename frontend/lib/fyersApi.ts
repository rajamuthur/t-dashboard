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
  if (res.status === 401) {
    clearToken();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error((await res.text()).replace(/^.*"detail":"?/, "").replace(/"?\}$/, "") || `API ${res.status}`);
  return res.status === 204 ? (undefined as T) : await res.json();
}

export interface FyersStatus { connected: boolean; message: string; expires_at?: number | null; }

export const getFyersStatus = () => call<FyersStatus>("/fyers/status");
export const fyersLogin = () => call<{ ok: boolean; message: string }>("/fyers/login", { method: "POST" });
export const getFyersAuthUrl = () => call<{ url: string }>("/fyers/auth-url");
export const fyersExchange = (authCode: string) =>
  call<{ ok: boolean; message: string }>("/fyers/exchange", { method: "POST", body: JSON.stringify({ auth_code: authCode }) });
