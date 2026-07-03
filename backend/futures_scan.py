"""
Futures basis / mispricing scanner.

For every F&O underlying (+ NIFTY / BANKNIFTY), pull spot + the next 3 monthly
future LTPs (Fyers), compute each contract's premium vs spot, and flag:
  - RICH / CHEAP vs spot   : |premium| >= threshold%  (default 5)
  - OFF-CURVE              : a month off the line implied by the other contracts
                            by >= curve_tol% (default 1.5) — the true "odd one out"

Focus = the front two contracts, rolling to the next two when the near month is
within ~7 days of expiry. On each run, NEW matches are logged + pushed to
Telegram (deduped so a persisting mispricing isn't re-sent); an expired Fyers
token pushes an alert every run.
"""
import asyncio
from datetime import datetime, timezone

import aiosqlite

from .db import _get_db_path
from .fyers_fo_master import fut_underlyings, next_contracts

INDEX_SPOT = {
    "NIFTY": "NSE:NIFTY50-INDEX", "BANKNIFTY": "NSE:NIFTYBANK-INDEX",
    "FINNIFTY": "NSE:FINNIFTY-INDEX", "MIDCPNIFTY": "NSE:MIDCPNIFTY-INDEX",
}
_NEAR_EXPIRY_DAYS = 7

_status: dict = {}
_result: dict = {"rows": [], "at": None, "params": {}}


def get_status() -> dict:
    return dict(_status)


def get_result() -> dict:
    return dict(_result)


def _spot_symbol(und: str) -> str:
    return INDEX_SPOT.get(und, f"NSE:{und}-EQ")


def _month_label(expiry: str) -> str:
    try:
        return datetime.strptime(expiry, "%Y-%m-%d").strftime("%b %y")
    except Exception:
        return expiry


def _residuals(contracts: list[dict]) -> dict:
    """Off-curve residual per contract: how far a month's premium sits from the
    straight line between its two neighbours (consecutive monthlies are evenly
    spaced, so expected = mean of the neighbours). Only interior months have both
    neighbours; this isolates the true 'odd one out' (e.g. a cheap middle month)
    without an outlier dragging a global fit."""
    resid = {}
    prem = [c["premium"] for c in contracts]
    for i in range(1, len(contracts) - 1):
        if prem[i] is None or prem[i - 1] is None or prem[i + 1] is None:
            continue
        resid[i] = prem[i] - (prem[i - 1] + prem[i + 1]) / 2
    return resid


def _apply_flags(contracts: list[dict], focus_idx: list[int], threshold: float, curve_tol: float):
    resid = _residuals(contracts)
    for i, c in enumerate(contracts):
        c["vs_spot"] = None; c["curve"] = None; c["action"] = None; c["focus"] = i in focus_idx
        if c["premium"] is None or i not in focus_idx:
            continue
        if abs(c["premium"]) >= threshold:
            c["vs_spot"] = "RICH" if c["premium"] > 0 else "CHEAP"
        r = resid.get(i)
        if r is not None and abs(r) >= curve_tol:
            c["curve"] = "ABOVE" if r > 0 else "BELOW"
        if c["vs_spot"] == "CHEAP" or c["curve"] == "BELOW":
            c["action"] = "BUY"     # underpriced → buy, expect reversion up
        elif c["vs_spot"] == "RICH" or c["curve"] == "ABOVE":
            c["action"] = "SHORT"   # overpriced → short


def _focus_indices(contracts: list[dict]) -> list[int]:
    if not contracts:
        return []
    near = contracts[0].get("epoch", 0) <= (datetime.now(timezone.utc).timestamp() + _NEAR_EXPIRY_DAYS * 86400)
    idx = [1, 2] if (near and len(contracts) >= 3) else [0, 1]
    return [i for i in idx if i < len(contracts)]


def _scan_sync(threshold: float, curve_tol: float, months: int, status: dict) -> list[dict]:
    from .downloaders.fyers import FyersDownloader
    d = FyersDownloader()
    unders = fut_underlyings()
    plan = []
    syms: set[str] = set()
    for u in unders:
        cs = next_contracts(u, months)
        if not cs:
            continue
        spot_sym = _spot_symbol(u)
        plan.append((u, spot_sym, cs))
        syms.add(spot_sym); syms.update(c["symbol"] for c in cs)
    status["step"] = f"Fetching {len(syms)} quotes…"; status["total"] = len(plan); status["done"] = 0
    quotes = d.quotes_batch(list(syms))

    rows = []
    for k, (u, spot_sym, cs) in enumerate(plan):
        status["done"] = k + 1; status["current"] = u
        spot = quotes.get(spot_sym)
        if not spot or spot <= 0:
            continue
        contracts = []
        for c in cs:
            price = quotes.get(c["symbol"])
            prem = round((price - spot) / spot * 100, 2) if price else None
            contracts.append({"month": _month_label(c["expiry"]), "symbol": c["symbol"], "expiry": c["expiry"],
                              "epoch": c["epoch"], "price": round(price, 2) if price else None, "premium": prem})
        focus = _focus_indices(contracts)
        _apply_flags(contracts, focus, threshold, curve_tol)
        flagged = any(c["vs_spot"] or c["curve"] for c in contracts)
        rows.append({"underlying": u, "spot": round(spot, 2), "contracts": contracts, "flagged": flagged})
    rows.sort(key=lambda r: max((abs(c["premium"]) for c in r["contracts"] if c["premium"] is not None), default=0), reverse=True)
    return rows


async def _log_and_alert(rows: list[dict]) -> int:
    """Persist NEW matches and Telegram them (deduped by underlying+month+action+day)."""
    db_path = _get_db_path()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    new_matches = []
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            """CREATE TABLE IF NOT EXISTS futures_matches (
                 id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, day TEXT, underlying TEXT,
                 month TEXT, action TEXT, kind TEXT, spot REAL, future REAL, premium REAL,
                 UNIQUE(day, underlying, month, action))"""
        )
        for r in rows:
            for c in r["contracts"]:
                if not (c["vs_spot"] or c["curve"]):
                    continue
                kind = "/".join([x for x in [c["vs_spot"], c["curve"]] if x])
                cur = await db.execute(
                    "INSERT OR IGNORE INTO futures_matches (ts, day, underlying, month, action, kind, spot, future, premium)"
                    " VALUES (?,?,?,?,?,?,?,?,?)",
                    [ts, today, r["underlying"], c["month"], c["action"] or "", kind, r["spot"], c["price"], c["premium"]],
                )
                if cur.rowcount:
                    new_matches.append((r["underlying"], c, r["spot"], kind))
        await db.commit()

    if new_matches:
        import html
        from .telegram_service import send_message
        lines = [f"\U0001F4C9 <b>Futures mispricing</b> — {len(new_matches)} new", ""]
        for und, c, spot, kind in new_matches[:30]:
            arrow = "\U0001F7E2 BUY" if c["action"] == "BUY" else "\U0001F534 SHORT"
            lines.append(f"{arrow} <b>{html.escape(und)}</b> {html.escape(c['month'])} — {c['price']} vs spot {spot} ({c['premium']:+}%) <i>{kind}</i>")
        try:
            await send_message("\n".join(lines))
        except Exception:
            pass
    return len(new_matches)


async def run_scan(threshold: float = 5.0, curve_tol: float = 1.5, months: int = 3, alert: bool = True) -> dict:
    global _status, _result
    _status = {"status": "running", "step": "Checking token…"}
    from .fyers_auth import token_status
    tok = await asyncio.to_thread(token_status)
    if not tok.get("connected"):
        if alert:
            try:
                from .telegram_service import send_message
                await send_message("⚠️ Fyers token expired — futures scan skipped. Re-login (Settings → Broker).")
            except Exception:
                pass
        _status = {"status": "failed", "message": f"Fyers token invalid: {tok.get('message', '')}", "token": False}
        return _status
    try:
        rows = await asyncio.to_thread(_scan_sync, threshold, curve_tol, months, _status)
        at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        _result = {"rows": rows, "at": at, "params": {"threshold": threshold, "curve_tol": curve_tol, "months": months}}
        new_count = await _log_and_alert(rows) if alert else 0
        flagged = sum(1 for r in rows if r["flagged"])
        _status = {"status": "completed", "at": at, "scanned": len(rows), "flagged": flagged, "new_alerts": new_count}
        return _status
    except Exception as exc:
        _status = {"status": "failed", "message": str(exc)}
        raise


async def history(limit: int = 100) -> list[dict]:
    db_path = _get_db_path()
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        try:
            async with db.execute("SELECT * FROM futures_matches ORDER BY id DESC LIMIT ?", [limit]) as cur:
                return [dict(r) for r in await cur.fetchall()]
        except Exception:
            return []


async def chart_data(underlying: str) -> dict:
    """Underlying daily candles + a spot reference line, for entry validation."""
    import sqlite3
    def _load():
        con = sqlite3.connect(_get_db_path())
        sym = _spot_symbol(underlying)
        rows = con.execute(
            "SELECT date, open, high, low, close, volume FROM candles WHERE symbol=? AND timeframe='day' ORDER BY date ASC",
            [sym],
        ).fetchall()
        con.close()
        candles = [{"date": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5]} for r in rows]
        shapes = []
        if candles:
            shapes.append({"type": "hline", "price": candles[-1]["close"], "color": "#22c55e", "label": "Spot"})
        focus = candles[-1]["date"][:10] if candles else None
        return {"candles": candles, "shapes": shapes, "focus_date": focus}
    return await asyncio.to_thread(_load)
