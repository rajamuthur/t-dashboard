from typing import Optional, List
import numpy as np
import pandas as pd
from .base import BaseScanner, ScanResult


class TightRangeScanner(BaseScanner):
    analysis_type = "tight_range"
    window_size = 30  # ~6 weeks of daily candles

    legend = [
        {"label": "Band High", "color": "#3b82f6", "text": "Resistance / band top"},
        {"label": "Entry",     "color": "#22c55e", "text": "Current close (potential entry)"},
        {"label": "Stop",      "color": "#ef4444", "text": "Stop loss (band low)"},
    ]

    def _rsi(self, df: pd.DataFrame, period: int = 14) -> Optional[float]:
        if len(df) < period + 1:
            return None
        close = df["close"]
        delta = close.diff()
        gain = delta.clip(lower=0).ewm(com=period - 1, min_periods=period).mean()
        loss = (-delta.clip(upper=0)).ewm(com=period - 1, min_periods=period).mean()
        rs = gain / loss.replace(0, float("nan"))
        val = (100 - 100 / (1 + rs)).iloc[-1]
        return float(val) if pd.notna(val) else None

    def run(self, symbol: str, timeframe: str, df: pd.DataFrame) -> ScanResult:
        if len(df) < self.window_size:
            return ScanResult(matched=False)

        window = df.iloc[-self.window_size :]

        # Rule 1: price band < 10%
        max_high = float(window["high"].max())
        min_low  = float(window["low"].min())
        if min_low <= 0:
            return ScanResult(matched=False)
        band_pct = (max_high - min_low) / min_low * 100
        if band_pct >= 10.0:
            return ScanResult(matched=False)

        # Rule 2: volume drying up — negative slope AND recent avg < period avg
        vols = window["volume"].values.astype(float)
        slope = float(np.polyfit(np.arange(len(vols)), vols, 1)[0])
        period_avg = float(vols.mean())
        recent_avg = float(vols[-5:].mean()) if len(vols) >= 5 else period_avg
        if period_avg == 0:
            return ScanResult(matched=False)
        vol_ratio = recent_avg / period_avg
        if slope >= 0 or vol_ratio >= 1.0:
            return ScanResult(matched=False)

        # Rule 3: RSI(14) >= 50 (computed on full df for accuracy)
        rsi = self._rsi(df, 14)
        if rsi is None or rsi < 50:
            return ScanResult(matched=False)

        # Rule 4: fewer than 30% of candles have big upper wicks (>= 40% of range)
        ranges      = (window["high"] - window["low"]).clip(lower=1e-9)
        body_highs  = window[["open", "close"]].max(axis=1)
        upper_wicks = window["high"] - body_highs
        big_wick_ratio = float((upper_wicks / ranges >= 0.4).sum()) / len(window)
        if big_wick_ratio > 0.30:
            return ScanResult(matched=False)

        candle_date = str(window.index[-1])[:10]
        close_price = float(window["close"].iloc[-1])
        details = {
            "band_pct":       round(band_pct, 2),
            "volume_slope":   round(slope, 2),
            "vol_ratio":      round(vol_ratio, 3),
            "rsi":            round(rsi, 2),
            "big_wick_ratio": round(big_wick_ratio * 100, 1),
            "entry_close":    round(close_price, 2),
            "stop_loss":      round(min_low, 2),
            "resistance":     round(max_high, 2),
            "band_high":      round(max_high, 2),
            "band_low":       round(min_low, 2),
        }
        return ScanResult(matched=True, details=details, candle_date=candle_date)
