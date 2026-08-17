"""
Chart image for a fired price-cross alert (sent to Telegram alongside the text).

Fetches the alert's own-timeframe candles and renders them with the crossed
level drawn on top (a horizontal line for horizontal alerts, the sloped line for
trend alerts) plus a dot at the candle where price crossed. Reuses the same
mplfinance renderer the pattern scanner uses (chart_render.render_pattern_png).
"""
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd

# timeframe -> (Fyers resolution, calendar days). 1wk/1mo fetch daily then resample.
# Canonical for the Alerts feature — routers/alerts.py imports these.
RES = {"5m": "5", "15m": "15", "30m": "30", "1h": "60", "1d": "D", "1wk": "D", "1mo": "D"}
RANGE_DAYS = {"5m": 25, "15m": 50, "30m": 80, "1h": 100, "1d": 360, "1wk": 360, "1mo": 360}
TIMEFRAMES = set(RES.keys())

# How many candles of context to show in the Telegram image (readable, not 1500).
_IMG_TAIL = {"5m": 90, "15m": 90, "30m": 80, "1h": 90, "1d": 130, "1wk": 100, "1mo": 72}


def _fmt_for(timeframe: str) -> str:
    return "%Y-%m-%d %H:%M:%S" if timeframe in ("5m", "15m", "30m", "1h") else "%Y-%m-%d"


def fetch_alert_candles(symbol: str, timeframe: str, tail: int = 1500) -> list[dict]:
    """OHLC for an alert's timeframe as [{date,open,high,low,close,volume}]."""
    from .downloaders.fyers import FyersDownloader
    res = RES.get(timeframe, "D")
    days = RANGE_DAYS.get(timeframe, 360)
    d = FyersDownloader()
    end = datetime.now()
    start = end - timedelta(days=days)
    df = d.fetch_daily(symbol, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"), resolution=res)
    if df is None or df.empty:
        return []
    if timeframe == "1wk":
        df = d.resample_weekly(df)
    elif timeframe == "1mo":
        df = d.resample_monthly(df)
    fmt = _fmt_for(timeframe)
    out = []
    for ts, r in df.iterrows():
        out.append({"date": pd.Timestamp(ts).strftime(fmt), "open": float(r["open"]), "high": float(r["high"]),
                    "low": float(r["low"]), "close": float(r["close"]), "volume": float(r.get("volume", 0) or 0)})
    return out[-tail:]


def _short(sym: str) -> str:
    return sym.replace("NSE:", "").replace("-EQ", "")


def render_alert_png(alert: dict, ltp: float, level: float, direction: str) -> Optional[bytes]:
    """PNG of the alert's chart with the crossed line + a cross marker. None on failure."""
    from .chart_render import render_pattern_png  # lazy: pulls in matplotlib

    timeframe = alert.get("timeframe") or "1d"
    candles = fetch_alert_candles(alert["symbol"], timeframe)
    if not candles:
        return None
    candles = candles[-(_IMG_TAIL.get(timeframe, 120)):]

    color = "#16a34a" if direction == "up" else "#dc2626"
    last_date = candles[-1]["date"]
    shapes: list[dict] = []

    if alert.get("kind") == "trend" and alert.get("t1") is not None and alert.get("p1") is not None:
        # Sloped line from its first anchor to the current (crossed) value.
        fmt = _fmt_for(timeframe)
        anchor_date = pd.Timestamp(int(alert["t1"]), unit="s", tz="UTC").tz_convert("Asia/Kolkata").strftime(fmt)
        shapes.append({"type": "trendline", "color": color, "points": [
            {"date": anchor_date, "price": float(alert["p1"])},
            {"date": last_date, "price": float(level)},
        ]})
    else:
        # Horizontal alert (or a trend alert missing anchors) -> a flat line at the level.
        shapes.append({"type": "hline", "price": float(level), "color": color})

    # Dot on the last candle where price crossed.
    shapes.append({"type": "marker", "date": last_date, "price": float(ltp), "color": color})

    verb = "crossed above" if direction == "up" else "crossed below"
    title = f"{_short(alert['symbol'])}  {verb} {round(level, 2)} · LTP {round(ltp, 2)}  ({timeframe})"
    try:
        return render_pattern_png(_short(alert["symbol"]), candles, shapes, title)
    except Exception:
        return None
