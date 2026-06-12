"""
Pluggable data source registry for the Live Charts dashboard.

Add a new broker by appending a class in this file and decorating it with
@register("name"). Nothing else changes — the router auto-discovers it via
list_sources() / get_source().
"""
from __future__ import annotations

import asyncio
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, asdict
from typing import Callable, Dict, List, Optional


@dataclass
class Candle:
    time: int          # Unix seconds (UTC)
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Quote:
    time: int          # Unix seconds (UTC)
    price: float


@dataclass
class SymbolMatch:
    symbol: str
    label: str       # human-readable description (company name, full coin name, etc.)


class DataSource(ABC):
    name: str = ""
    timeframes: List[str] = []
    default_symbols: List[str] = []
    label: str = ""

    @abstractmethod
    async def fetch_candles(self, symbol: str, timeframe: str, limit: int = 300) -> List[Candle]:
        ...

    @abstractmethod
    async def fetch_quote(self, symbol: str) -> Optional[Quote]:
        ...

    async def search(self, query: str, limit: int = 10) -> List[SymbolMatch]:
        """Symbol autocomplete. Default: substring filter over default_symbols."""
        q = query.strip().upper()
        if not q:
            return [SymbolMatch(symbol=s, label=s) for s in self.default_symbols[:limit]]
        return [
            SymbolMatch(symbol=s, label=s)
            for s in self.default_symbols if q in s.upper()
        ][:limit]


_REGISTRY: Dict[str, DataSource] = {}


def register(name: str) -> Callable[[type], type]:
    def deco(cls: type) -> type:
        instance = cls()
        instance.name = name
        _REGISTRY[name] = instance
        return cls
    return deco


def get_source(name: str) -> DataSource:
    if name not in _REGISTRY:
        raise KeyError(f"Unknown data source: {name}")
    return _REGISTRY[name]


def list_sources() -> List[Dict]:
    return [
        {
            "name": s.name,
            "label": s.label or s.name,
            "timeframes": s.timeframes,
            "default_symbols": s.default_symbols,
        }
        for s in _REGISTRY.values()
    ]


# --------------------------------------------------------------------------
# NSE Futures & Options stock universe (used as the India default list)
# Indices first, then stocks alphabetical. Snapshot ~2026. Edit freely.
# --------------------------------------------------------------------------
_FNO_INDIA: List[str] = [
    "^NSEI", "^NSEBANK", "^BSESN", "^CNXIT", "^CNXFIN",
    # stocks (suffix .NS appended below at module load)
]
_FNO_STOCKS = [
    "ADANIENT", "ADANIPORTS", "AMBUJACEM", "APOLLOHOSP", "ASIANPAINT",
    "AUROPHARMA", "AXISBANK", "BAJAJ-AUTO", "BAJAJFINSV", "BAJFINANCE",
    "BANDHANBNK", "BANKBARODA", "BATAINDIA", "BEL", "BERGEPAINT",
    "BHARATFORG", "BHARTIARTL", "BIOCON", "BOSCHLTD", "BPCL",
    "BRITANNIA", "BSOFT", "CANBK", "CHAMBLFERT", "CHOLAFIN",
    "CIPLA", "COALINDIA", "COFORGE", "COLPAL", "CONCOR",
    "COROMANDEL", "CROMPTON", "CUB", "CUMMINSIND", "DABUR",
    "DALBHARAT", "DEEPAKNTR", "DIVISLAB", "DIXON", "DLF",
    "DRREDDY", "EICHERMOT", "ESCORTS", "EXIDEIND", "FEDERALBNK",
    "GAIL", "GLENMARK", "GMRINFRA", "GNFC", "GODREJCP",
    "GODREJPROP", "GRANULES", "GRASIM", "GUJGASLTD", "HAL",
    "HAVELLS", "HCLTECH", "HDFCAMC", "HDFCBANK", "HDFCLIFE",
    "HEROMOTOCO", "HINDALCO", "HINDCOPPER", "HINDPETRO", "HINDUNILVR",
    "ICICIBANK", "ICICIGI", "ICICIPRULI", "IDEA", "IDFCFIRSTB",
    "IEX", "IGL", "INDHOTEL", "INDIACEM", "INDIAMART",
    "INDIGO", "INDUSINDBK", "INDUSTOWER", "INFY", "IOC",
    "IRCTC", "ITC", "JINDALSTEL", "JKCEMENT", "JSWSTEEL",
    "JUBLFOOD", "KOTAKBANK", "LALPATHLAB", "LAURUSLABS", "LICHSGFIN",
    "LT", "LTIM", "LTTS", "LUPIN", "M&M", "M&MFIN",
    "MANAPPURAM", "MARICO", "MARUTI", "MCDOWELL-N", "MCX",
    "METROPOLIS", "MFSL", "MGL", "MOTHERSON", "MPHASIS",
    "MRF", "MUTHOOTFIN", "NATIONALUM", "NAUKRI", "NAVINFLUOR",
    "NESTLEIND", "NMDC", "NTPC", "OBEROIRLTY", "OFSS", "ONGC",
    "PAGEIND", "PEL", "PERSISTENT", "PETRONET", "PFC",
    "PIDILITIND", "PIIND", "PNB", "POLYCAB", "POWERGRID",
    "PVRINOX", "RAMCOCEM", "RBLBANK", "RECLTD", "RELIANCE",
    "SAIL", "SBICARD", "SBILIFE", "SBIN", "SHREECEM",
    "SIEMENS", "SRF", "SUNPHARMA", "SUNTV", "SYNGENE",
    "TATACHEM", "TATACOMM", "TATACONSUM", "TATAMOTORS", "TATAPOWER",
    "TATASTEEL", "TCS", "TECHM", "TITAN", "TORNTPHARM",
    "TRENT", "TVSMOTOR", "UBL", "ULTRACEMCO", "UNITDSPR",
    "UPL", "VEDL", "VOLTAS", "WIPRO", "ZEEL", "ZYDUSLIFE",
]
_FNO_INDIA += [f"{s}.NS" for s in _FNO_STOCKS]


# --------------------------------------------------------------------------
# Shared yfinance base — used by both the India and US sources.
# Subclasses override default_symbols, label, and ALLOWED predicate.
# --------------------------------------------------------------------------
class _YFinanceBase(DataSource):
    timeframes = ["1m", "5m", "15m", "30m", "1h", "1d", "1wk", "1mo"]
    _PERIOD_FOR_TF = {
        "1m": "5d", "5m": "1mo", "15m": "1mo",
        "30m": "2mo", "1h": "6mo", "1d": "2y",
        "1wk": "10y", "1mo": "max",
    }
    _YH_SEARCH = "https://query2.finance.yahoo.com/v1/finance/search"
    _yh_region: str = "US"
    _yh_lang: str = "en-US"

    def _allowed_symbol(self, symbol: str, exchange: str = "") -> bool:
        """Region-restricted filter for search results. Subclasses override."""
        return True

    async def fetch_candles(self, symbol: str, timeframe: str, limit: int = 300) -> List[Candle]:
        import yfinance as yf
        period = self._PERIOD_FOR_TF.get(timeframe, "1mo")

        def _fetch():
            t = yf.Ticker(symbol)
            return t.history(period=period, interval=timeframe, auto_adjust=False)

        df = await asyncio.to_thread(_fetch)
        if df is None or df.empty:
            return []
        df = df.tail(limit)
        out: List[Candle] = []
        for ts, row in df.iterrows():
            try:
                unix = int(ts.timestamp())
            except Exception:
                continue
            out.append(Candle(
                time=unix,
                open=float(row["Open"]),
                high=float(row["High"]),
                low=float(row["Low"]),
                close=float(row["Close"]),
                volume=float(row.get("Volume", 0) or 0),
            ))
        return out

    async def fetch_quote(self, symbol: str) -> Optional[Quote]:
        import yfinance as yf

        def _fetch():
            t = yf.Ticker(symbol)
            try:
                info = t.fast_info
                for attr in ("last_price", "regular_market_price", "previous_close"):
                    val = getattr(info, attr, None)
                    if val:
                        return float(val)
            except Exception:
                pass
            for period, interval in (("1d", "1m"), ("5d", "5m"), ("1mo", "1d")):
                try:
                    df = t.history(period=period, interval=interval)
                    if df is not None and not df.empty:
                        return float(df["Close"].iloc[-1])
                except Exception:
                    continue
            return None

        price = await asyncio.to_thread(_fetch)
        if price is None:
            return None
        return Quote(time=int(time.time()), price=price)

    async def search(self, query: str, limit: int = 50) -> List[SymbolMatch]:
        q = query.strip()
        qu = q.upper()

        # 1) Local hits first — startswith beats contains, and matches are restricted to our universe.
        local: List[SymbolMatch] = []
        if not qu:
            local = [SymbolMatch(symbol=s, label=s) for s in self.default_symbols[:limit]]
        else:
            starts = [s for s in self.default_symbols if s.upper().startswith(qu) or s.upper().lstrip("^").startswith(qu)]
            contains = [s for s in self.default_symbols if qu in s.upper() and s not in starts]
            local = [SymbolMatch(symbol=s, label=s) for s in (starts + contains)[:limit]]
            if len(local) >= limit:
                return local

        # 2) Hit Yahoo for symbols not in our local list, filtered to this source's region.
        if not qu:
            return local
        import httpx
        params = {"q": q, "quotesCount": 25, "newsCount": 0, "lang": self._yh_lang, "region": self._yh_region}
        headers = {"User-Agent": "Mozilla/5.0 (live-charts)"}
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(self._YH_SEARCH, params=params, headers=headers)
                r.raise_for_status()
                payload = r.json()
        except Exception:
            return local

        seen = {m.symbol for m in local}
        for q_ in payload.get("quotes", []):
            sym = q_.get("symbol")
            exch = q_.get("exchange") or ""
            if not sym or sym in seen or not self._allowed_symbol(sym, exch):
                continue
            label_parts = [
                q_.get("shortname") or q_.get("longname") or "",
                q_.get("exchDisp") or q_.get("exchange") or "",
                q_.get("typeDisp") or q_.get("quoteType") or "",
            ]
            desc = " · ".join(p for p in label_parts if p)
            local.append(SymbolMatch(symbol=sym, label=f"{sym} — {desc}" if desc else sym))
            seen.add(sym)
            if len(local) >= limit:
                break
        return local


# --------------------------------------------------------------------------
# yfinance — India (NSE/BSE, F&O universe)
# --------------------------------------------------------------------------
@register("yfinance")
class YFinanceIndia(_YFinanceBase):
    label = "yfinance (India)"
    default_symbols = list(_FNO_INDIA)
    _yh_region = "IN"
    _yh_lang = "en-IN"

    def _allowed_symbol(self, symbol: str, exchange: str = "") -> bool:
        # NSE/BSE listings end in .NS / .BO; indices use ^NSE/^BSE prefixes.
        if symbol.startswith("^"):
            return symbol.startswith(("^NSE", "^BSE", "^CNX"))
        return symbol.endswith((".NS", ".BO"))


# --------------------------------------------------------------------------
# yfinance — US (NASDAQ / NYSE / AMEX, plus major indices & ETFs)
# --------------------------------------------------------------------------
_US_DEFAULTS = [
    # indices
    "^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX",
    # mega-cap tech
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA", "AVGO", "ORCL",
    "ADBE", "NFLX", "CRM", "AMD", "INTC", "IBM", "CSCO", "QCOM", "TXN", "MU",
    # finance
    "JPM", "BAC", "WFC", "GS", "MS", "C", "V", "MA", "PYPL", "AXP",
    # healthcare
    "JNJ", "PFE", "UNH", "LLY", "ABBV", "MRK", "TMO", "DHR",
    # consumer
    "WMT", "COST", "KO", "PEP", "MCD", "DIS", "NKE", "HD", "TGT", "SBUX",
    # energy / industrial
    "XOM", "CVX", "BA", "CAT", "GE", "F", "GM",
    # popular ETFs
    "SPY", "QQQ", "DIA", "IWM", "VTI", "VOO", "ARKK", "GLD", "TLT",
]


@register("yfinance_us")
class YFinanceUS(_YFinanceBase):
    label = "yfinance (US)"
    default_symbols = list(_US_DEFAULTS)
    _yh_region = "US"
    _yh_lang = "en-US"

    # Yahoo internal exchange codes for US listings.
    _US_EXCHANGES = {"NMS", "NGM", "NCM", "NYQ", "ASE", "PCX", "BTS", "OQB", "PNK"}

    def _allowed_symbol(self, symbol: str, exchange: str = "") -> bool:
        if symbol.startswith("^"):
            return symbol.startswith(("^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX", "^NDX", "^SPX"))
        # Prefer Yahoo's exchange field when present — it's authoritative.
        if exchange:
            return exchange.upper() in self._US_EXCHANGES
        # Fallback (no exchange info): bare ticker or BRK.B-style class share only.
        if "." not in symbol:
            return True
        parts = symbol.split(".")
        return len(parts) == 2 and parts[1] in ("A", "B")


# --------------------------------------------------------------------------
# Hyperliquid — crypto (historical via REST; live ticks via browser WS)
# --------------------------------------------------------------------------
@register("hyperliquid")
class HyperliquidSource(DataSource):
    label = "Hyperliquid (crypto)"
    timeframes = ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"]
    default_symbols = ["BTC", "ETH", "SOL", "ARB", "OP", "AVAX", "MATIC", "DOGE", "LINK", "INJ"]

    REST_URL = "https://api.hyperliquid.xyz/info"
    _MS_FOR_TF = {
        "1m": 60_000, "5m": 5 * 60_000, "15m": 15 * 60_000,
        "1h": 60 * 60_000, "4h": 4 * 60 * 60_000, "1d": 24 * 60 * 60_000,
        "1w": 7 * 24 * 60 * 60_000, "1M": 30 * 24 * 60 * 60_000,
    }
    _universe_cache: Optional[List[str]] = None

    async def fetch_candles(self, symbol: str, timeframe: str, limit: int = 300) -> List[Candle]:
        import httpx

        ms_per = self._MS_FOR_TF.get(timeframe, 60 * 60_000)
        end = int(time.time() * 1000)
        start = end - ms_per * limit
        payload = {
            "type": "candleSnapshot",
            "req": {"coin": symbol, "interval": timeframe, "startTime": start, "endTime": end},
        }
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(self.REST_URL, json=payload)
            r.raise_for_status()
            rows = r.json() or []
        out: List[Candle] = []
        for c in rows:
            out.append(Candle(
                time=int(c["t"]) // 1000,
                open=float(c["o"]),
                high=float(c["h"]),
                low=float(c["l"]),
                close=float(c["c"]),
                volume=float(c.get("v", 0) or 0),
            ))
        return out

    async def fetch_quote(self, symbol: str) -> Optional[Quote]:
        import httpx

        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(self.REST_URL, json={"type": "allMids"})
            r.raise_for_status()
            mids = r.json() or {}
        price = mids.get(symbol)
        if price is None:
            return None
        return Quote(time=int(time.time()), price=float(price))

    async def _universe(self) -> List[str]:
        if self._universe_cache is not None:
            return self._universe_cache
        import httpx
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(self.REST_URL, json={"type": "meta"})
                r.raise_for_status()
                meta = r.json() or {}
            self._universe_cache = [u["name"] for u in meta.get("universe", []) if u.get("name")]
        except Exception:
            self._universe_cache = list(self.default_symbols)
        return self._universe_cache

    async def search(self, query: str, limit: int = 10) -> List[SymbolMatch]:
        coins = await self._universe()
        q = query.strip().upper()
        if not q:
            return [SymbolMatch(symbol=c, label=c) for c in coins[:limit]]
        starts = [c for c in coins if c.upper().startswith(q)]
        contains = [c for c in coins if q in c.upper() and c not in starts]
        return [SymbolMatch(symbol=c, label=c) for c in (starts + contains)[:limit]]


# --------------------------------------------------------------------------
# How to add a new broker (e.g. Binance, Alpaca, Zerodha, Polygon):
#
# @register("binance")
# class BinanceSource(DataSource):
#     label = "Binance"
#     timeframes = ["1m", "5m", "15m", "1h", "4h", "1d"]
#     default_symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
#
#     async def fetch_candles(self, symbol, timeframe, limit=300):
#         ...   # call Binance REST /api/v3/klines
#         return [...]
#
#     async def fetch_quote(self, symbol):
#         ...   # call /api/v3/ticker/price
#         return Quote(...)
# --------------------------------------------------------------------------
