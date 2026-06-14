"""
Render a pattern's candlestick chart (with entry/stop/target lines, trendlines,
and markers) to a PNG using mplfinance. Headless (Agg backend) — no browser.
"""
from io import BytesIO
from typing import List, Optional

import matplotlib
matplotlib.use("Agg")  # headless
import matplotlib.pyplot as plt  # noqa: E402
import mplfinance as mpf          # noqa: E402
import pandas as pd               # noqa: E402


def render_pattern_png(symbol: str, candles: List[dict], shapes: List[dict],
                       title: Optional[str] = None) -> Optional[bytes]:
    """candles: [{date,open,high,low,close,volume}]; shapes: pattern geometry."""
    if not candles:
        return None

    df = pd.DataFrame(candles)
    df["Date"] = pd.to_datetime(df["date"])
    df.set_index("Date", inplace=True)
    df = df.rename(columns={"open": "Open", "high": "High", "low": "Low",
                            "close": "Close", "volume": "Volume"})
    df = df[["Open", "High", "Low", "Close", "Volume"]].astype(float)

    # Horizontal lines (entry/stop/target) and sloped trendlines.
    hlines, hcolors = [], []
    alines, acolors = [], []
    for s in shapes:
        if s.get("type") == "hline" and s.get("price") is not None:
            hlines.append(float(s["price"]))
            hcolors.append(s.get("color", "#888888"))
        elif s.get("type") in ("trendline", "polyline") and s.get("points"):
            try:
                pts = [(pd.to_datetime(p["date"]), float(p["price"])) for p in s["points"]]
                alines.append(pts)
                acolors.append(s.get("color", "#a855f7"))
            except Exception:
                pass

    addplots = []
    # Markers (C1/C2/C3) as scatter overlays.
    for s in shapes:
        if s.get("type") == "marker" and s.get("date") and s.get("price") is not None:
            try:
                d = pd.to_datetime(s["date"])
                col = pd.Series(float("nan"), index=df.index)
                if d in col.index:
                    col.loc[d] = float(s["price"])
                    addplots.append(mpf.make_addplot(
                        col, type="scatter", marker="o", markersize=60,
                        color=s.get("color", "#333333")))
            except Exception:
                pass

    style = mpf.make_mpf_style(base_mpf_style="yahoo", rc={"font.size": 9})
    kwargs = dict(
        type="candle", style=style, volume=True, figratio=(16, 9), figscale=1.1,
        title=title or symbol, returnfig=True, tight_layout=True,
    )
    if hlines:
        kwargs["hlines"] = dict(hlines=hlines, colors=hcolors, linestyle="--", linewidths=0.9)
    if alines:
        kwargs["alines"] = dict(alines=alines, colors=acolors, linewidths=1.3)
    if addplots:
        kwargs["addplot"] = addplots

    try:
        fig, _axes = mpf.plot(df, **kwargs)
    except Exception:
        # Fall back to a bare candlestick if annotation wiring fails.
        fig, _axes = mpf.plot(df, type="candle", style=style, volume=True,
                              figratio=(16, 9), figscale=1.1, title=title or symbol,
                              returnfig=True, tight_layout=True)

    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()
