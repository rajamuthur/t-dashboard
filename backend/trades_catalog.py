"""
Lot-size and expiry-date catalogs for the Trades module.

NSE F&O lot sizes change quarterly. The values below are an approximate
snapshot — users can override per-trade in the form. Keep this list edited
when SEBI/NSE publishes lot revisions.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

# --------------------------------------------------------------------------
# Index lot sizes + Yahoo Finance underlying symbol for live-price proxy.
# --------------------------------------------------------------------------
INDEX_CATALOG: Dict[str, Dict] = {
    "NIFTY":       {"lot_size": 75,  "yahoo": "^NSEI",     "label": "NIFTY 50",     "weekly": True},
    "BANKNIFTY":   {"lot_size": 30,  "yahoo": "^NSEBANK",  "label": "BANK NIFTY",   "weekly": True},
    "FINNIFTY":    {"lot_size": 65,  "yahoo": "^CNXFIN",   "label": "FIN NIFTY",    "weekly": False},
    "MIDCPNIFTY":  {"lot_size": 75,  "yahoo": "^NSEMDCP50","label": "MIDCAP NIFTY", "weekly": False},
    "NIFTYNEXT50": {"lot_size": 25,  "yahoo": "^NSMIDCP",  "label": "NIFTY NEXT 50","weekly": False},
    "SENSEX":      {"lot_size": 20,  "yahoo": "^BSESN",    "label": "SENSEX",       "weekly": True},
    "BANKEX":      {"lot_size": 30,  "yahoo": "^BSEBANK",  "label": "BANKEX",       "weekly": False},
}

# Stock F&O lot sizes (subset of the F&O universe).
STOCK_LOT_SIZES: Dict[str, int] = {
    "ADANIENT": 300, "ADANIPORTS": 700, "AMBUJACEM": 1500, "APOLLOHOSP": 125,
    "ASIANPAINT": 200, "AUROPHARMA": 600, "AXISBANK": 625, "BAJAJ-AUTO": 75,
    "BAJAJFINSV": 500, "BAJFINANCE": 125, "BANDHANBNK": 3600, "BANKBARODA": 2925,
    "BATAINDIA": 425, "BEL": 2850, "BERGEPAINT": 1100, "BHARATFORG": 600,
    "BHARTIARTL": 475, "BIOCON": 2300, "BOSCHLTD": 25, "BPCL": 1800,
    "BRITANNIA": 200, "CANBK": 5400, "CHOLAFIN": 625, "CIPLA": 425,
    "COALINDIA": 2100, "COFORGE": 100, "COLPAL": 350, "CONCOR": 1000,
    "CROMPTON": 1800, "CUMMINSIND": 200, "DABUR": 1250, "DEEPAKNTR": 250,
    "DIVISLAB": 200, "DIXON": 50, "DLF": 825, "DRREDDY": 625,
    "EICHERMOT": 175, "ESCORTS": 200, "EXIDEIND": 1800, "FEDERALBNK": 5000,
    "GAIL": 4575, "GLENMARK": 875, "GMRINFRA": 9000, "GODREJCP": 500,
    "GRANULES": 1700, "GRASIM": 250, "HAL": 150, "HAVELLS": 500,
    "HCLTECH": 350, "HDFCAMC": 150, "HDFCBANK": 550, "HDFCLIFE": 1100,
    "HEROMOTOCO": 150, "HINDALCO": 1075, "HINDPETRO": 1300, "HINDUNILVR": 300,
    "ICICIBANK": 700, "ICICIGI": 325, "ICICIPRULI": 1000, "IDEA": 60000,
    "IDFCFIRSTB": 9275, "IGL": 1100, "INDHOTEL": 1250, "INDIGO": 300,
    "INDUSINDBK": 500, "INFY": 400, "IOC": 6500, "IRCTC": 875,
    "ITC": 1600, "JINDALSTEL": 750, "JSWSTEEL": 675, "JUBLFOOD": 1250,
    "KOTAKBANK": 400, "LICHSGFIN": 1100, "LT": 150, "LTIM": 150,
    "LTTS": 150, "LUPIN": 425, "M&M": 350, "MARICO": 1200,
    "MARUTI": 50, "MFSL": 800, "MGL": 400, "MOTHERSON": 6500,
    "MPHASIS": 275, "MRF": 5, "MUTHOOTFIN": 375, "NATIONALUM": 4350,
    "NAUKRI": 125, "NESTLEIND": 250, "NMDC": 3375, "NTPC": 1500,
    "ONGC": 2250, "PAGEIND": 15, "PEL": 700, "PERSISTENT": 100,
    "PETRONET": 1800, "PFC": 1300, "PIDILITIND": 250, "PNB": 8000,
    "POLYCAB": 100, "POWERGRID": 1900, "PVRINOX": 407, "RAMCOCEM": 700,
    "RBLBANK": 3666, "RECLTD": 1250, "RELIANCE": 500, "SAIL": 6850,
    "SBICARD": 800, "SBILIFE": 375, "SBIN": 750, "SHREECEM": 25,
    "SIEMENS": 125, "SRF": 250, "SUNPHARMA": 700, "SUNTV": 1300,
    "SYNGENE": 1000, "TATACONSUM": 550, "TATAMOTORS": 1425, "TATAPOWER": 3375,
    "TATASTEEL": 5500, "TCS": 175, "TECHM": 600, "TITAN": 175,
    "TORNTPHARM": 250, "TRENT": 100, "TVSMOTOR": 350, "ULTRACEMCO": 100,
    "UPL": 1300, "VEDL": 1550, "VOLTAS": 500, "WIPRO": 1500,
    "ZYDUSLIFE": 600,
}


def lookup_lot_size(underlying: str) -> Optional[int]:
    """Lot size for an underlying — live Fyers F&O master first (kept current as
    NSE revises lots quarterly), then the static snapshots as fallback."""
    u = (underlying or "").strip().upper()
    try:
        from .fyers_fo_master import lot_size as _fo_lot
        m = _fo_lot(u)
        if m:
            return m
    except Exception:
        pass
    if u in INDEX_CATALOG:
        return INDEX_CATALOG[u]["lot_size"]
    if u in STOCK_LOT_SIZES:
        return STOCK_LOT_SIZES[u]
    return None


def underlying_yahoo_symbol(underlying: str) -> str:
    """Best-effort Yahoo ticker for an underlying. Indices map explicitly; stocks get '.NS' appended."""
    u = (underlying or "").strip().upper()
    if u in INDEX_CATALOG:
        return INDEX_CATALOG[u]["yahoo"]
    # Fall back to assuming an NSE-listed equity (already-suffixed inputs pass through).
    if u.endswith(".NS") or u.endswith(".BO"):
        return u
    return f"{u}.NS"


# --------------------------------------------------------------------------
# Expiry calendar — NSE monthly expiry = last Thursday of the month.
# Weekly expiries (NIFTY/BANKNIFTY/SENSEX) fall on every Thursday.
# --------------------------------------------------------------------------
def _last_thursday(year: int, month: int) -> date:
    """Last Thursday of the given month."""
    _, last_day = calendar.monthrange(year, month)
    for day in range(last_day, 0, -1):
        d = date(year, month, day)
        if d.weekday() == 3:  # 0=Mon, 3=Thu
            return d
    raise RuntimeError("unreachable")


def _next_thursdays(today: date, count: int) -> List[date]:
    days_ahead = (3 - today.weekday()) % 7 or 7
    first = today + timedelta(days=days_ahead) if today.weekday() != 3 else today
    return [first + timedelta(days=7 * i) for i in range(count)]


def list_expiries(underlying: str, today: Optional[date] = None, months: int = 6) -> Dict[str, List[str]]:
    """Return upcoming weekly (if applicable) and monthly expiries for an underlying.

    Format: ISO date strings YYYY-MM-DD. Weeklies for the next 4 weeks,
    monthlies for the next `months` (default 6) future months. Same date may
    appear in both buckets (monthly Thursday = last weekly of the month).
    """
    today = today or date.today()
    u = (underlying or "").strip().upper()
    weekly_enabled = INDEX_CATALOG.get(u, {}).get("weekly", False)

    weekly: List[str] = []
    if weekly_enabled:
        weekly = [d.isoformat() for d in _next_thursdays(today, 4)]

    monthly: List[str] = []
    y, m = today.year, today.month
    # Walk forward until we collect `months` future expiries.
    while len(monthly) < months:
        d = _last_thursday(y, m)
        if d >= today:
            monthly.append(d.isoformat())
        m += 1
        if m == 13:
            m = 1; y += 1
    return {"weekly": weekly, "monthly": monthly}


def format_option_symbol(underlying: str, expiry: str, option_type: str, strike: float) -> str:
    """Pretty trade label e.g. 'NIFTY 29MAY26 CE 25000'."""
    try:
        d = datetime.strptime(expiry, "%Y-%m-%d").date()
        exp_label = d.strftime("%d%b%y").upper()
    except Exception:
        exp_label = expiry
    strike_str = f"{int(strike)}" if float(strike).is_integer() else f"{strike:g}"
    return f"{underlying.upper()} {exp_label} {option_type.upper()} {strike_str}"


def format_future_symbol(underlying: str, expiry: str) -> str:
    try:
        d = datetime.strptime(expiry, "%Y-%m-%d").date()
        exp_label = d.strftime("%d%b%y").upper()
    except Exception:
        exp_label = expiry
    return f"{underlying.upper()} {exp_label} FUT"
