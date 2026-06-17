"use client";
import { useEffect, useState } from "react";
import LiveChartPane, { PaneConfig } from "@/components/LiveChartPane";
import { LiveSource, getSources } from "@/lib/liveSources";
import { hyperliquidStatus, usMarketStatus, inMarketStatus, MarketStatus } from "@/lib/marketHours";

const COUNT_OPTIONS = [1, 2, 4, 6, 8] as const;
const COUNT_LABEL: Record<number, string> = {
  1: "1 (Full)",
  2: "2 (Side by side)",
  4: "4 (2×2)",
  6: "6 (3×2)",
  8: "8 (4×2)",
};
const GRID_CLASS: Record<number, string> = {
  1: "grid-cols-1 grid-rows-1",
  2: "grid-cols-2 grid-rows-1",
  4: "grid-cols-2 grid-rows-2",
  6: "grid-cols-3 grid-rows-2",
  8: "grid-cols-4 grid-rows-2",
};

const LS_COUNT = "live-charts:count";
const LS_PANES = "live-charts:panes";

function loadStoredCount(): number {
  if (typeof window === "undefined") return 2;
  const raw = window.localStorage.getItem(LS_COUNT);
  const n = raw ? parseInt(raw, 10) : NaN;
  return (COUNT_OPTIONS as readonly number[]).includes(n) ? n : 2;
}

const LS_VOL_MIGRATED = "live-charts:volume-default-v1";

function loadStoredPanes(): PaneConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_PANES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const panes = parsed.filter(p => p && typeof p.source === "string" && typeof p.symbol === "string" && typeof p.timeframe === "string");
    // One-time migration: ensure existing panes show volume by default. Runs
    // once, then user toggles are respected (so removing volume sticks).
    if (!window.localStorage.getItem(LS_VOL_MIGRATED)) {
      panes.forEach(p => {
        const inds = Array.isArray(p.indicators) ? p.indicators : [];
        if (!inds.includes("volume")) p.indicators = [...inds, "volume"];
      });
      window.localStorage.setItem(LS_VOL_MIGRATED, "1");
    }
    return panes;
  } catch {
    return [];
  }
}

// Preferred mix when first opening the page: 1 BTC + 2 India + 1 US, then keep cycling.
const DEFAULT_RECIPE: Array<{ source: string; symbol?: string }> = [
  { source: "hyperliquid", symbol: "BTC" },
  { source: "yfinance",    symbol: "RELIANCE.NS" },
  { source: "yfinance",    symbol: "INFY.NS" },
  { source: "yfinance_us", symbol: "AAPL" },
  { source: "hyperliquid", symbol: "ETH" },
  { source: "yfinance",    symbol: "HDFCBANK.NS" },
  { source: "yfinance_us", symbol: "NVDA" },
  { source: "yfinance",    symbol: "TCS.NS" },
];

function defaultPane(sources: LiveSource[], i: number): PaneConfig {
  const recipe = DEFAULT_RECIPE[i % DEFAULT_RECIPE.length];
  const src = sources.find(s => s.name === recipe.source) ?? sources[0];
  const symbol = recipe.symbol ?? src.default_symbols[0];
  return {
    source: src.name,
    symbol,
    timeframe: src.timeframes.includes("5m") ? "5m" : src.timeframes[0],
    indicators: ["volume"],   // volume on by default; other indicators opt-in via the panel
  };
}

function StatusPill({ label, status }: { label: string; status: MarketStatus }) {
  const open = status === "open";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
        open
          ? "bg-green-500/10 border-green-500/30 text-green-300"
          : "bg-gray-700/30 border-gray-600/40 text-gray-400"
      }`}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${open ? "bg-green-400" : "bg-gray-500"}`}
      />
      {label} {open ? "live" : "closed"}
    </span>
  );
}

export default function LiveChartsPage() {
  const [sources, setSources] = useState<LiveSource[] | null>(null);
  const [count, setCount] = useState<number>(2);
  const [panes, setPanes] = useState<PaneConfig[]>([]);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState({
    hl: hyperliquidStatus(),
    us: usMarketStatus(),
    in: inMarketStatus(),
  });

  // Re-evaluate market hours every 30s so pills flip on session boundaries.
  useEffect(() => {
    const id = window.setInterval(() => {
      setStatuses({ hl: hyperliquidStatus(), us: usMarketStatus(), in: inMarketStatus() });
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Load sources + restore preferences
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const srcs = await getSources();
        if (!alive) return;
        if (srcs.length === 0) {
          setError("No data sources registered on the backend.");
          return;
        }
        setSources(srcs);
        const storedCount = loadStoredCount();
        const stored = loadStoredPanes();
        const next: PaneConfig[] = [];
        for (let i = 0; i < storedCount; i++) {
          next.push(stored[i] ?? defaultPane(srcs, i));
        }
        setCount(storedCount);
        setPanes(next);
        setBootstrapped(true);
      } catch (e: any) {
        setError(e?.message || "Failed to load sources");
      }
    })();
    return () => { alive = false; };
  }, []);

  // Persist count
  useEffect(() => {
    if (!bootstrapped) return;
    window.localStorage.setItem(LS_COUNT, String(count));
  }, [count, bootstrapped]);

  // Persist panes
  useEffect(() => {
    if (!bootstrapped) return;
    window.localStorage.setItem(LS_PANES, JSON.stringify(panes));
  }, [panes, bootstrapped]);

  function setCountAndResize(next: number) {
    if (!sources) return;
    setCount(next);
    setPanes(prev => {
      if (next <= prev.length) return prev.slice(0, next);
      const out = [...prev];
      for (let i = prev.length; i < next; i++) out.push(defaultPane(sources, i));
      return out;
    });
  }

  function updatePane(i: number, cfg: PaneConfig) {
    setPanes(prev => prev.map((p, idx) => (idx === i ? cfg : p)));
  }

  if (error) {
    return (
      <div className="p-4 text-red-400 text-sm">{error}</div>
    );
  }
  if (!sources || !bootstrapped) {
    return (
      <div className="p-4 text-gray-500 text-sm">Loading data sources…</div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 -m-6">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-semibold text-white">Live Charts</h1>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[10px] tracking-wider uppercase text-gray-500">Number of charts</span>
            <select
              value={count}
              onChange={e => setCountAndResize(parseInt(e.target.value, 10))}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
              title={COUNT_LABEL[count]}
            >
              {COUNT_OPTIONS.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill label="HL" status={statuses.hl} />
          <StatusPill label="US market" status={statuses.us} />
          <StatusPill label="IN market" status={statuses.in} />
        </div>
      </div>

      {/* Grid */}
      <div className={`flex-1 min-h-0 grid gap-2 p-2 ${GRID_CLASS[count]}`}>
        {panes.map((p, i) => (
          <LiveChartPane
            key={i}
            config={p}
            sources={sources}
            onChange={cfg => updatePane(i, cfg)}
          />
        ))}
      </div>
    </div>
  );
}
