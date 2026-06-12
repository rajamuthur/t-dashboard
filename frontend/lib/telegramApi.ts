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

export interface TelegramConfig {
  enabled: boolean;
  chat_id: string;
  bot_token_set: boolean;
  bot_token_hint: string;
}

export const getTelegramConfig = () =>
  call<TelegramConfig>("/telegram/config");

export const saveTelegramConfig = (body: { enabled: boolean; chat_id: string; bot_token?: string }) =>
  call<{ ok: boolean; enabled: boolean; chat_id: string; bot_token_set: boolean }>(
    "/telegram/config",
    { method: "PUT", body: JSON.stringify(body) },
  );

export const testTelegram = () =>
  call<{ ok: boolean; chunks?: number }>("/telegram/test", { method: "POST" });

export const sendToTelegram = (kind: "scans" | "trades", ids: number[], title?: string) =>
  call<{ ok: boolean; sent: number }>("/telegram/send", {
    method: "POST",
    body: JSON.stringify({ kind, ids, title }),
  });
