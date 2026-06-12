/**
 * Static catalog of indicators offered in the Indicators panel.
 * Keep this in sync with the rendering code in LiveChartPane.tsx
 * (the rendering switch reads `id` to look up the calc function).
 */

export type IndicatorCategory = "trend" | "price" | "volume" | "oscillator";
export type RenderStyle = "overlay" | "pane";

export interface IndicatorMeta {
  id: string;            // stable key used by render code
  label: string;         // shown in the panel
  category: IndicatorCategory;
  render: RenderStyle;   // overlay = on price pane;  pane = own sub-pane
}

export const CATEGORY_ORDER: IndicatorCategory[] = ["trend", "price", "volume", "oscillator"];
export const CATEGORY_LABEL: Record<IndicatorCategory, string> = {
  trend: "TREND",
  price: "PRICE ACTION",
  volume: "VOLUME",
  oscillator: "OSCILLATORS",
};

export const INDICATORS: IndicatorMeta[] = [
  // TREND
  { id: "sma20",       label: "SMA (20)",         category: "trend",      render: "overlay" },
  { id: "ema50",       label: "EMA (50)",         category: "trend",      render: "overlay" },
  { id: "bb",          label: "Bollinger (20, 2)", category: "trend",     render: "overlay" },
  { id: "supertrend",  label: "Supertrend (10, 3)", category: "trend",   render: "overlay" },
  { id: "ichimoku",    label: "Ichimoku Cloud",   category: "trend",      render: "overlay" },
  { id: "pivots",      label: "Pivot Points",     category: "trend",      render: "overlay" },

  // PRICE ACTION
  { id: "fvg",         label: "Fair Value Gaps",          category: "price", render: "overlay" },
  { id: "vp",          label: "Volume Profile (POC/VA)",  category: "price", render: "overlay" },

  // VOLUME
  { id: "volume",      label: "Volume",  category: "volume", render: "pane" },

  // OSCILLATORS
  { id: "rsi",         label: "RSI (14)",            category: "oscillator", render: "pane" },
  { id: "macd",        label: "MACD (12, 26, 9)",    category: "oscillator", render: "pane" },
  { id: "stoch",       label: "Stochastic (14, 3, 3)", category: "oscillator", render: "pane" },
  { id: "atr",         label: "ATR (14)",            category: "oscillator", render: "pane" },
  { id: "adx",         label: "ADX (14)",            category: "oscillator", render: "pane" },
  { id: "cci",         label: "CCI (20)",            category: "oscillator", render: "pane" },
  { id: "obv",         label: "OBV",                 category: "oscillator", render: "pane" },
  { id: "mfi",         label: "MFI (14)",            category: "oscillator", render: "pane" },
  { id: "williams",    label: "Williams %R",         category: "oscillator", render: "pane" },
];

// Start with no indicators — user opts in via the panel.
export const DEFAULT_INDICATORS = new Set<string>();

export const INDICATOR_COLOR: Record<string, string> = {
  sma20: "#60a5fa", ema50: "#f59e0b",
  bb_upper: "#a78bfa", bb_lower: "#a78bfa", bb_mid: "#a78bfa80",
  supertrend: "#22d3ee",
  ichi_tenkan: "#f87171", ichi_kijun: "#60a5fa",
  ichi_senkouA: "#22c55e80", ichi_senkouB: "#ef444480",
  ichi_chikou: "#fbbf24",
  pivot_pp: "#facc15", pivot_r: "#22c55e", pivot_s: "#ef4444",
  fvg_bull: "#22c55e40", fvg_bear: "#ef444440",
  vp_poc: "#a78bfa", vp_vah: "#22c55e", vp_val: "#ef4444",
  rsi: "#a78bfa", macd_line: "#22d3ee", macd_signal: "#f59e0b",
  stoch_k: "#22d3ee", stoch_d: "#f59e0b",
  atr: "#facc15", adx: "#a78bfa", adx_plus: "#22c55e", adx_minus: "#ef4444",
  cci: "#22d3ee", obv: "#60a5fa", mfi: "#a78bfa", williams: "#f59e0b",
};
