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
from datetime import datetime
from typing import Dict, Optional

import requests

_CSV_URL = "https://public.fyers.in/sym_details/NSE_FO.csv"
_CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
_CACHE_FILE = os.path.join(_CACHE_DIR, "fo_lots.json")
_MAX_AGE_SEC = 24 * 3600

# Column layout of NSE_FO.csv (positional, no header): see module probe.
_COL_LOT = 3
_COL_TRADING_SYMBOL = 9
_COL_UNDERLYING = 13

_lots: Optional[Dict[str, int]] = None     # in-process memo


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


def _refresh() -> Dict[str, int]:
    resp = requests.get(_CSV_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=40)
    resp.raise_for_status()
    lots = _parse_csv(resp.text)
    if lots:
        try:
            os.makedirs(_CACHE_DIR, exist_ok=True)
            with open(_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(lots, f)
        except Exception:
            pass
    return lots


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
        _lots = _refresh()
    except Exception:
        _lots = {}
    return _lots


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
