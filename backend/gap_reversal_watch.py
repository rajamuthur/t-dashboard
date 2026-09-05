"""
Gap-Reversal "Entry for tomorrow" watch.

Daily: find F&O stocks whose RSI-on-EMA (day chart) is in the extreme zone
(>= band_upper or <= band_lower); keep each until its RSI crosses back inside.
At EOD the list goes to Telegram. Next morning (09:08, fallback 09:15) any watched
stock that gaps in its setup direction fires a high-priority entry alert with a chart.
"""
import asyncio
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

import pandas as pd

from .db import _get_db_path
from .gap_reversal_scan import get_config, compute
from .universe_service import get_universe_stocks

_status: dict = {}


def get_watch_status() -> dict:
    return dict(_status)


def _ist_now() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)


def _today_ist() -> str:
    return _ist_now().strftime("%Y-%m-%d")


def _short(sym: str) -> str:
    return sym.replace("NSE:", "").replace("-EQ", "")


def _quotes(syms: list[str]) -> dict:
    from .downloaders.fyers import FyersDownloader
    if not syms:
        return {}
    return FyersDownloader().quotes_full(syms)


# ---------------------------------------------------------------------------
# Daily watch update
# ---------------------------------------------------------------------------
def _scan_extremes_sync(stocks: list[str], cfg: dict, status: dict) -> list[dict]:
    """Fresh daily fetch per F&O stock → those with RSI-on-EMA in the extreme zone."""
    from .downloaders.fyers import FyersDownloader
    d = FyersDownloader()
    end = datetime.now()
    start = end - timedelta(days=260)
    s0, s1 = start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
    min_bars = int(cfg["ema_length"]) + int(cfg["rsi_length"]) + 5
    done = [0]
    total = len(stocks)

    def one(sym: str):
        done[0] += 1
        status.update({"done": done[0], "total": total, "step": f"{done[0]}/{total}"})
        try:
            df = d.fetch_daily(sym, s0, s1, resolution="D")
            if df is None or df.empty or len(df) < min_bars:
                return None
            a = compute(df, cfg)
            i = len(a["c"]) - 1
            rsi = a["rsi"][i]
            if rsi is None or rsi != rsi:   # NaN
                return None
            if rsi >= cfg["band_upper"]:
                dirn = "overbought"
            elif rsi <= cfg["band_lower"]:
                dirn = "oversold"
            else:
                return None
            return {"symbol": sym, "direction": dirn, "rsi_ema": round(float(rsi), 2),
                    "ema": round(float(a["ema"][i]), 2), "close": round(float(a["c"][i]), 2),
                    "low": round(float(a["l"][i]), 2), "high": round(float(a["h"][i]), 2)}
        except Exception:
            return None

    out = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for r in ex.map(one, stocks):
            if r:
                out.append(r)
    return out


async def update_watch(cfg: dict | None = None) -> dict:
    global _status
    cfg = cfg or await get_config()
    _status = {"status": "running", "step": "Resolving F&O universe…"}
    stocks = await get_universe_stocks(cfg["universe"])
    _status.update({"step": f"Scanning {len(stocks)} stocks…", "total": len(stocks)})
    extremes = await asyncio.to_thread(_scan_extremes_sync, stocks, cfg, _status)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    today = _today_ist()
    ex_syms = {e["symbol"] for e in extremes}

    def _persist():
        db = sqlite3.connect(_get_db_path(), timeout=15)
        try:
            existing = {r[0]: r[1] for r in db.execute("SELECT symbol, entered_date FROM gap_watch").fetchall()}
            for e in extremes:
                entered = existing.get(e["symbol"]) or today
                db.execute(
                    """INSERT INTO gap_watch (symbol,direction,rsi_ema,ema,last_close,last_low,last_high,entered_date,last_updated)
                       VALUES (?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(symbol) DO UPDATE SET direction=excluded.direction, rsi_ema=excluded.rsi_ema,
                         ema=excluded.ema, last_close=excluded.last_close, last_low=excluded.last_low,
                         last_high=excluded.last_high, last_updated=excluded.last_updated""",
                    [e["symbol"], e["direction"], e["rsi_ema"], e["ema"], e["close"], e["low"], e["high"], entered, now],
                )
            for sym in existing:
                if sym not in ex_syms:
                    db.execute("DELETE FROM gap_watch WHERE symbol=?", [sym])
            db.commit()
        finally:
            db.close()

    await asyncio.to_thread(_persist)
    counts = {"count": len(extremes),
              "oversold": sum(1 for e in extremes if e["direction"] == "oversold"),
              "overbought": sum(1 for e in extremes if e["direction"] == "overbought"),
              "scanned": len(stocks), "at": now}
    _status = {"status": "completed", **counts}
    return counts


def _load_watch() -> list[dict]:
    db = sqlite3.connect(_get_db_path(), timeout=15)
    db.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in db.execute(
            "SELECT * FROM gap_watch ORDER BY direction, rsi_ema DESC").fetchall()]
    finally:
        db.close()


async def watch_with_quotes() -> dict:
    rows = await asyncio.to_thread(_load_watch)
    quotes = await asyncio.to_thread(_quotes, [r["symbol"] for r in rows])
    for r in rows:
        q = quotes.get(r["symbol"]) or {}
        r["name"] = _short(r["symbol"])
        r["lp"] = q.get("lp")
        r["chp"] = q.get("chp")
    return {"rows": rows, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


# ---------------------------------------------------------------------------
# EOD Telegram list
# ---------------------------------------------------------------------------
async def send_watch_eod(force: bool = False) -> dict:
    cfg = await get_config()
    if not force and not cfg.get("watch_enabled", True):
        return {"skipped": "disabled"}
    from .routers.holidays import get_holiday_set, is_trading_day
    if not force and not is_trading_day(date.today(), await get_holiday_set()):
        return {"skipped": "not a trading day"}

    await update_watch(cfg)
    rows = await asyncio.to_thread(_load_watch)
    from .telegram_service import send_message
    day = _ist_now().strftime("%d %b %Y")
    if not rows:
        msg = f"\U0001F440 <b>Entry for tomorrow</b> — {day}\nNo F&O stocks in the extreme zone."
    else:
        under = [r for r in rows if r["direction"] == "oversold"]
        over = [r for r in rows if r["direction"] == "overbought"]
        lines = [f"\U0001F440 <b>Entry for tomorrow</b> — {day} · {len(rows)} stock(s)"]
        if under:
            lines.append(f"\n\U0001F7E2 <b>Oversold ≤{cfg['band_lower']}</b> — gap-up → long:")
            lines += [f"• {_short(r['symbol'])}  RSI {r['rsi_ema']} · close {r['last_close']}" for r in under]
        if over:
            lines.append(f"\n\U0001F53B <b>Overbought ≥{cfg['band_upper']}</b> — gap-down → short:")
            lines += [f"• {_short(r['symbol'])}  RSI {r['rsi_ema']} · close {r['last_close']}" for r in over]
        msg = "\n".join(lines)
    res = await send_message(msg)
    return {"count": len(rows), "delivered": res.get("ok"), "error": res.get("error")}


# ---------------------------------------------------------------------------
# Morning gap-entry alerts
# ---------------------------------------------------------------------------
def _render_watch_chart(symbol: str, name: str, direction: str, cfg: dict) -> bytes | None:
    from .alerts_image import fetch_alert_candles
    from .chart_render import render_pattern_png
    candles = fetch_alert_candles(symbol, "1d")
    if not candles:
        return None
    candles = candles[-130:]
    ema = pd.Series([c["close"] for c in candles]).ewm(span=int(cfg["ema_length"]), adjust=False).mean()
    ema_pts = [{"date": candles[k]["date"], "price": round(float(ema.iloc[k]), 2)} for k in range(len(candles))]
    shapes = [{"type": "trendline", "color": "#2563eb", "points": ema_pts}]
    title = f"{name}  {'gap-up long' if direction == 'BULL' else 'gap-down short'}"
    try:
        return render_pattern_png(name, candles, shapes, title)
    except Exception:
        return None


async def _fire_entry(r: dict, lp: float, gap: float, direction: str, cfg: dict) -> bool:
    from .telegram_service import send_message, send_photo
    name = _short(r["symbol"])
    stop = r.get("last_low") if direction == "BULL" else r.get("last_high")
    risk = (lp - stop) if (direction == "BULL" and stop) else (stop - lp) if stop else None
    tgt_txt = "—"
    if risk and risk > 0:
        tgt_txt = " · ".join(
            f"1:{k}={round(lp + k * risk, 2) if direction == 'BULL' else round(lp - k * risk, 2)}"
            for k in cfg["rr_targets"])
    arrow = "\U0001F53A" if direction == "BULL" else "\U0001F53B"
    setup = "LONG (oversold + gap-up)" if direction == "BULL" else "SHORT (overbought + gap-down)"
    msg = (
        f"\U0001F6A8 <b>GAP ENTRY</b> {arrow} <b>{name}</b>\n{setup}\n"
        f"Open {round(lp, 2)} · gap {'+' if gap >= 0 else ''}{round(gap, 2)}% · RSI {r['rsi_ema']}\n"
        f"Stop {round(stop, 2) if stop else '—'} · Targets {tgt_txt}"
    )
    res = await send_message(msg)
    if res.get("ok"):
        try:
            png = await asyncio.to_thread(_render_watch_chart, r["symbol"], name, direction, cfg)
            if png:
                await send_photo(png, caption="")
        except Exception:
            pass
    return bool(res.get("ok"))


async def check_morning_gaps(cfg: dict | None = None, force: bool = False) -> dict:
    cfg = cfg or await get_config()
    if not force and not cfg.get("watch_enabled", True):
        return {"skipped": "disabled"}
    from .routers.holidays import get_holiday_set, is_trading_day
    if not force and not is_trading_day(date.today(), await get_holiday_set()):
        return {"skipped": "not a trading day"}

    rows = await asyncio.to_thread(_load_watch)
    today = _today_ist()
    todo = [r for r in rows if r.get("alerted_date") != today]
    if not todo:
        return {"checked": 0, "fired": 0}
    quotes = await asyncio.to_thread(_quotes, [r["symbol"] for r in todo])

    fired: list[str] = []
    for r in todo:
        q = quotes.get(r["symbol"]) or {}
        lp = q.get("lp")
        if lp is None or not r.get("last_close"):
            continue
        gap = (lp - r["last_close"]) / r["last_close"] * 100
        if r["direction"] == "oversold" and gap >= cfg["gap_pct"]:
            if await _fire_entry(r, lp, gap, "BULL", cfg):
                fired.append(r["symbol"])
        elif r["direction"] == "overbought" and gap <= -cfg["gap_pct"]:
            if await _fire_entry(r, lp, gap, "BEAR", cfg):
                fired.append(r["symbol"])

    if fired:
        def _mark():
            db = sqlite3.connect(_get_db_path(), timeout=15)
            try:
                db.executemany("UPDATE gap_watch SET alerted_date=? WHERE symbol=?", [(today, s) for s in fired])
                db.commit()
            finally:
                db.close()
        await asyncio.to_thread(_mark)
    return {"checked": len(todo), "fired": len(fired)}
