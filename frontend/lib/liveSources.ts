import { getToken } from "./auth";

const BASE = "/api/backend";

async function get<T>(path: string): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface LiveSource {
  name: string;
  label: string;
  timeframes: string[];
  default_symbols: string[];
}

export interface LiveCandle {
  time: number;     // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LiveQuote {
  time: number;
  price: number;
}

export const getSources = () =>
  get<LiveSource[]>("/live-charts/sources");

export const getLiveCandles = (source: string, symbol: string, timeframe: string, limit = 300) =>
  get<LiveCandle[]>(
    `/live-charts/candles?source=${encodeURIComponent(source)}` +
    `&symbol=${encodeURIComponent(symbol)}` +
    `&timeframe=${encodeURIComponent(timeframe)}` +
    `&limit=${limit}`,
  );

export const getLiveQuote = (source: string, symbol: string) =>
  get<LiveQuote>(
    `/live-charts/quote?source=${encodeURIComponent(source)}&symbol=${encodeURIComponent(symbol)}`,
  );

export interface SymbolMatch {
  symbol: string;
  label: string;
}
export const searchSymbols = (source: string, q: string, limit = 10) =>
  get<SymbolMatch[]>(
    `/live-charts/search?source=${encodeURIComponent(source)}` +
    `&q=${encodeURIComponent(q)}&limit=${limit}`,
  );

// ---- Hyperliquid WebSocket helper -------------------------------------------------
// Singleton WS connection multiplexed across all panes that want hyperliquid data.

type CandleMsg = {
  channel: "candle";
  data: { t: number; o: string; h: string; l: string; c: string; v: string; s: string; i: string };
};

type Sub = {
  coin: string;
  interval: string;
  onCandle: (c: LiveCandle) => void;
};

class HyperliquidWS {
  private ws: WebSocket | null = null;
  private subs = new Map<string, Sub>();
  private connecting = false;
  private reconnectDelay = 1000;

  private key(coin: string, interval: string) {
    return `${coin}|${interval}`;
  }

  private connect() {
    if (this.ws || this.connecting) return;
    this.connecting = true;
    try {
      const ws = new WebSocket("wss://api.hyperliquid.xyz/ws");
      this.ws = ws;
      ws.onopen = () => {
        this.connecting = false;
        this.reconnectDelay = 1000;
        for (const sub of this.subs.values()) this.sendSubscribe(sub);
      };
      ws.onclose = () => {
        this.ws = null;
        this.connecting = false;
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as CandleMsg;
          if (msg.channel !== "candle") return;
          const d = msg.data;
          const sub = this.subs.get(this.key(d.s, d.i));
          if (!sub) return;
          sub.onCandle({
            time: Math.floor(d.t / 1000),
            open: parseFloat(d.o),
            high: parseFloat(d.h),
            low: parseFloat(d.l),
            close: parseFloat(d.c),
            volume: parseFloat(d.v),
          });
        } catch {}
      };
    } catch {
      this.connecting = false;
    }
  }

  private sendSubscribe(sub: Sub) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      method: "subscribe",
      subscription: { type: "candle", coin: sub.coin, interval: sub.interval },
    }));
  }

  private sendUnsubscribe(coin: string, interval: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      method: "unsubscribe",
      subscription: { type: "candle", coin, interval },
    }));
  }

  subscribe(coin: string, interval: string, onCandle: (c: LiveCandle) => void): () => void {
    const k = this.key(coin, interval);
    // Replace any existing handler for this key (one pane per key — fine for our UI)
    this.subs.set(k, { coin, interval, onCandle });
    this.connect();
    this.sendSubscribe({ coin, interval, onCandle });
    return () => {
      this.subs.delete(k);
      this.sendUnsubscribe(coin, interval);
    };
  }
}

let _hl: HyperliquidWS | null = null;
export function getHyperliquidWS(): HyperliquidWS {
  if (typeof window === "undefined") {
    throw new Error("Hyperliquid WS is browser-only");
  }
  if (!_hl) _hl = new HyperliquidWS();
  return _hl;
}
