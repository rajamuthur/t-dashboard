"""
Fyers F&O instrument master — authoritative lot sizes + contract tickers.

The master is a PUBLIC CSV (no token needed), refreshed daily by Fyers. We fetch
it, extract per-underlying lot sizes, and cache a small JSON so we don't re-pull
17 MB on every lookup. NSE revises F&O lot sizes quarterly, so this keeps the
Trades module current instead of relying on a hand-maintained snapshot.

Contract tickers (NSE:SRF26AUGFUT, NSE:SRF26AUG2700CE) are built deterministically
from underlying + expiry (+ strike/right) — Fyers' monthly-contract convention.
"""
import csv
import io
import json
import os
import time
from datetime import datetime, timezone
from typing import Dict, Optional

import requests

_CSV_URL = "https://public.fyers.in/sym_details/NSE_FO.csv"
_CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
_CACHE_FILE = os.path.join(_CACHE_DIR, "fo_lots.json")
_MAX_AGE_SEC = 24 * 3600

# Column layout of NSE_FO.csv (positional, no header): see module probe.
_COL_LOT = 3
_COL_EXP_EPOCH = 8
_COL_TRADING_SYMBOL = 9
_COL_UNDERLYING = 13

_FUTS_CACHE_FILE = os.path.join(_CACHE_DIR, "fo_futs.json")
_lots: Optional[Dict[str, int]] = None     # in-process memo
_futs: Optional[dict] = None


def _parse_csv(text: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for row in csv.reader(io.StringIO(text)):
        if len(row) <= _COL_UNDERLYING:
            continue
        und = (row[_COL_UNDERLYING] or "").strip().upper()
        try:
            lot = int(float(row[_COL_LOT]))
        except (ValueError, TypeError):
            continue
        if und and lot > 0:
            out[und] = lot                  # same lot across a symbol's contracts
    return out


def _load_cache() -> Optional[Dict[str, int]]:
    try:
        if os.path.exists(_CACHE_FILE) and (time.time() - os.path.getmtime(_CACHE_FILE)) < _MAX_AGE_SEC:
            with open(_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return None


def _parse_futs(text: str) -> dict:
    """{underlying: [{symbol, epoch, expiry}...]} for FUT contracts, expiry-sorted."""
    out: dict = {}
    for row in csv.reader(io.StringIO(text)):
        if len(row) <= _COL_UNDERLYING:
            continue
        sym = (row[_COL_TRADING_SYMBOL] or "").strip()
        if not sym.upper().endswith("FUT"):
            continue
        und = (row[_COL_UNDERLYING] or "").strip().upper()
        try:
            epoch = int(float(row[_COL_EXP_EPOCH]))
        except (ValueError, TypeError):
            continue
        if not und or epoch <= 0:
            continue
        out.setdefault(und, []).append(
            {"symbol": sym, "epoch": epoch,
             "expiry": datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%d")})
    for und in out:
        out[und].sort(key=lambda c: c["epoch"])
    return out


def _refresh() -> tuple[Dict[str, int], dict]:
    resp = requests.get(_CSV_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=40)
    resp.raise_for_status()
    lots = _parse_csv(resp.text)
    futs = _parse_futs(resp.text)
    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        if lots:
            with open(_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(lots, f)
        if futs:
            with open(_FUTS_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(futs, f)
    except Exception:
        pass
    return lots, futs


def get_lot_sizes() -> Dict[str, int]:
    """Cached {underlying: lot_size} (memo → fresh disk cache → fetch)."""
    global _lots
    if _lots is not None:
        return _lots
    cached = _load_cache()
    if cached:
        _lots = cached
        return _lots
    try:
        _lots = _refresh()[0]
    except Exception:
        _lots = {}
    return _lots


def _load_futs_cache() -> Optional[dict]:
    try:
        if os.path.exists(_FUTS_CACHE_FILE) and (time.time() - os.path.getmtime(_FUTS_CACHE_FILE)) < _MAX_AGE_SEC:
            with open(_FUTS_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return None


def get_fut_contracts() -> dict:
    """Cached {underlying: [{symbol, epoch, expiry}...]} (sorted by expiry)."""
    global _futs
    if _futs is not None:
        return _futs
    cached = _load_futs_cache()
    if cached:
        _futs = cached
        return _futs
    try:
        _futs = _refresh()[1]
    except Exception:
        _futs = {}
    return _futs


def next_contracts(underlying: str, n: int = 3) -> list[dict]:
    """The next n monthly futures (expiry from today onward), soonest first."""
    conts = get_fut_contracts().get((underlying or "").strip().upper(), [])
    upcoming = [c for c in conts if c["epoch"] >= time.time() - 86400]
    return upcoming[:n]


def fut_underlyings() -> list[str]:
    return sorted(get_fut_contracts().keys())


# Index underlyings in the master — excluded from the F&O *stock* universe.
_INDEX_UNDERLYINGS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50",
                      "NIFTYNEXT50", "SENSEX", "BANKEX"}


def fo_stock_symbols() -> list[str]:
    """Current F&O stock universe as NSE:<UND>-EQ (indices excluded), from the
    daily-refreshed Fyers master — the authoritative live list (vs a stale cache)."""
    return sorted(f"NSE:{u}-EQ" for u in fut_underlyings() if u not in _INDEX_UNDERLYINGS)


def force_refresh() -> int:
    """Re-download the master (bypassing the 24h cache) and return the F&O stock
    count. Used by the weekly verification job."""
    global _lots, _futs
    _lots, _futs = _refresh()
    return len([u for u in _futs if u not in _INDEX_UNDERLYINGS])


def lot_size(underlying: str) -> Optional[int]:
    return get_lot_sizes().get((underlying or "").strip().upper())


def _exp_parts(expiry: str) -> tuple[str, str]:
    """('2026-08-25') -> ('26', 'AUG')."""
    d = datetime.strptime(expiry, "%Y-%m-%d").date()
    return d.strftime("%y"), d.strftime("%b").upper()


def future_symbol(underlying: str, expiry: str) -> Optional[str]:
    """Fyers monthly future ticker, e.g. NSE:SRF26AUGFUT."""
    try:
        yy, mmm = _exp_parts(expiry)
    except Exception:
        return None
    return f"NSE:{underlying.strip().upper()}{yy}{mmm}FUT"


def option_symbol(underlying: str, expiry: str, opt_type: str, strike: float) -> Optional[str]:
    """Fyers monthly option ticker, e.g. NSE:SRF26AUG2700CE."""
    try:
        yy, mmm = _exp_parts(expiry)
    except Exception:
        return None
    k = int(strike) if float(strike).is_integer() else strike
    return f"NSE:{underlying.strip().upper()}{yy}{mmm}{k}{opt_type.strip().upper()}"
