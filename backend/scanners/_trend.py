"""
Shared trend-context filter for pattern scanners.

Trading a pattern *with* the prevailing trend has materially better expectancy
than trading it counter-trend (continuation patterns ride the trend; reversal
patterns like stars become high-probability "buy-the-dip / sell-the-rally"
entries when gated this way). Every scanner reserves a leading slice of its
window as trend context and requires the trade direction to align.

The lead is a fixed number of candles prepended to each scanner's window
(`LEAD`), giving >= ~1 month of context on daily/weekly. VCP is exempt — its
full Trend Template gate is stronger than this lightweight check.
"""
import numpy as np
import pandas as pd

# Candles of trend context prepended to each scanner's pattern window.
# ~2 months on daily; comfortably >= the "use at least 1 month" requirement.
LEAD = 40


def trend_aligned(lead_df: pd.DataFrame, direction: str) -> bool:
    """True if the trend over `lead_df` aligns with the trade `direction`.

    Uses a short-vs-long mean stack plus a normalised linear slope over the lead
    window. Deliberately lightweight (no 200-MA) so it works on the modest lead
    each scanner can afford.
    """
    if lead_df is None or len(lead_df) < 10:
        return False
    closes = lead_df["close"].to_numpy(dtype=float)
    n = len(closes)
    last = float(closes[-1])
    if last <= 0:
        return False
    x = np.arange(n)
    slope = float(np.polyfit(x, closes, 1)[0])
    norm_slope = slope / last                      # per-candle drift, price-normalised
    short_mean = float(closes[-min(n, 10):].mean())
    long_mean = float(closes.mean())

    if direction == "bullish":
        return norm_slope > 0.0002 and short_mean >= long_mean and last >= long_mean
    if direction == "bearish":
        # Stricter: in an up-drifting equity market a reliable SHORT context needs
        # a clearly steeper decline, else mean-reversion up erodes the edge.
        return norm_slope < -0.0005 and short_mean <= long_mean and last <= long_mean
    return True
