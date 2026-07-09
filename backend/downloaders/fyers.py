import os
import threading
import time as _time
import pandas as pd
from datetime import datetime
from dotenv import load_dotenv
from fyers_apiv3 import fyersModel

# Fyers access tokens expire daily (~6 AM IST) and the refresh-token API is
# disabled (SEBI), so a fresh token requires a full TOTP re-login. When a call
# hits an expired token we self-heal by running that login — but a burst of
# failing calls (refresh-all, a futures scan) must trigger AT MOST one login,
# hence a process-wide lock + cooldown shared across all downloader instances.
_AUTO_LOGIN_LOCK = threading.Lock()
_LAST_AUTO_LOGIN = 0.0
_LAST_AUTO_OK = False
_AUTO_LOGIN_COOLDOWN = 120.0


class FyersDownloader:
    def __init__(self):
        # Re-read .env so a token refreshed out-of-process (the daily auto-login
        # task) is picked up without restarting the backend.
        load_dotenv(override=True)
        self._app_id = os.getenv("CLIENT_APP_ID", "")
        self._secret = os.getenv("APP_SECRET", "")
        self._fyers  = self._build_client()

    @staticmethod
    def _load_access_token() -> str:
        """Prefer a token pasted at runtime via Settings (config table), so the
        daily Fyers re-login is a paste — no .env edit / restart. Falls back to
        the ACCESS_TOKEN env var."""
        try:
            import json
            import sqlite3
            from ..db import _get_db_path
            con = sqlite3.connect(_get_db_path(), timeout=15)
            row = con.execute("SELECT value FROM config WHERE key='fyers_token'").fetchone()
            con.close()
            if row and row[0]:
                tok = json.loads(row[0])
                if tok:
                    return str(tok).strip()
        except Exception:
            pass
        return os.getenv("ACCESS_TOKEN", "")

    def _build_client(self):
        return fyersModel.FyersModel(
            client_id=self._app_id,
            token=self._load_access_token(),
            log_path="",
        )

    def _try_refresh(self) -> bool:
        """Token expired/invalid → mint a fresh one via TOTP auto-login. Fyers
        disabled the refresh-token API (SEBI, -16), so a full re-login is the
        ONLY working path. Process-wide cooldown so concurrent failing calls
        trigger at most one login; on success the client is rebuilt from the
        freshly stored token."""
        global _LAST_AUTO_LOGIN, _LAST_AUTO_OK
        with _AUTO_LOGIN_LOCK:
            now = _time.monotonic()
            if now - _LAST_AUTO_LOGIN < _AUTO_LOGIN_COOLDOWN:
                # A very recent attempt already ran — reuse its outcome rather
                # than hammering the login endpoint.
                if _LAST_AUTO_OK:
                    self._fyers = self._build_client()
                return _LAST_AUTO_OK
            _LAST_AUTO_LOGIN = now
            try:
                from ..fyers_auth import auto_login
                _LAST_AUTO_OK = bool(auto_login().get("ok"))
            except Exception:
                _LAST_AUTO_OK = False
        if _LAST_AUTO_OK:
            self._fyers = self._build_client()
        return _LAST_AUTO_OK

    def fetch_daily(self, symbol: str, start: str, end: str, _retried: bool = False,
                    resolution: str = "D") -> pd.DataFrame:
        payload = {
            "symbol": symbol,
            "resolution": resolution,        # "D" daily, "5"/"15"/... intraday minutes
            "date_format": "1",
            "range_from": start,
            "range_to": end,
            "cont_flag": "1",
        }
        resp = self._fyers.history(payload)
        if isinstance(resp, dict) and resp.get("s") == "error" and not _retried:
            if self._try_refresh():
                return self.fetch_daily(symbol, start, end, _retried=True, resolution=resolution)
        if not resp or "candles" not in resp or not resp["candles"]:
            return pd.DataFrame()
        df = pd.DataFrame(resp["candles"], columns=["ts", "open", "high", "low", "close", "volume"])
        df["date"] = pd.to_datetime(df["ts"], unit="s", utc=True).dt.tz_convert("Asia/Kolkata")
        df.set_index("date", inplace=True)
        df.drop(columns=["ts"], inplace=True)
        return df

    def quote(self, symbol: str, _retried: bool = False):
        """Live LTP for a Fyers symbol (e.g. NSE:SRF26AUGFUT). None if unavailable."""
        resp = self._fyers.quotes({"symbols": symbol})
        if isinstance(resp, dict) and resp.get("s") == "error" and not _retried:
            if self._try_refresh():
                return self.quote(symbol, _retried=True)
        if isinstance(resp, dict) and resp.get("s") == "ok" and resp.get("d"):
            v = resp["d"][0].get("v", {}) or {}
            lp = v.get("lp") or v.get("last_price")
            return float(lp) if lp else None
        return None

    def quotes_batch(self, symbols: list, _retried: bool = False) -> dict:
        """Live quote for many symbols → {symbol: {"lp": float, "volume": float}}.
        Batches ≤50 per Fyers call. `volume` is today's traded volume — 0 means
        the contract hasn't traded and its LTP is a stale carry-over, so callers
        can drop illiquid quotes."""
        out: dict = {}
        for i in range(0, len(symbols), 50):
            chunk = symbols[i:i + 50]
            resp = self._fyers.quotes({"symbols": ",".join(chunk)})
            if isinstance(resp, dict) and resp.get("s") == "error" and not _retried:
                if self._try_refresh():
                    return self.quotes_batch(symbols, _retried=True)
            if isinstance(resp, dict) and resp.get("d"):
                for item in resp["d"]:
                    n = item.get("n"); v = item.get("v", {}) or {}
                    lp = v.get("lp") or v.get("last_price")
                    if n and lp:
                        out[n] = {"lp": float(lp), "volume": float(v.get("volume") or 0)}
        return out

    def quotes_full(self, symbols: list, _retried: bool = False) -> dict:
        """Rich quote for many symbols → {symbol: {lp, chp, ch, prev_close, name}}.
        For the watchlist (needs change %). Batches ≤50; self-heals on auth error."""
        out: dict = {}
        for i in range(0, len(symbols), 50):
            chunk = symbols[i:i + 50]
            resp = self._fyers.quotes({"symbols": ",".join(chunk)})
            if isinstance(resp, dict) and resp.get("s") == "error" and not _retried:
                if self._try_refresh():
                    return self.quotes_full(symbols, _retried=True)
            if isinstance(resp, dict) and resp.get("d"):
                for item in resp["d"]:
                    n = item.get("n"); v = item.get("v", {}) or {}
                    lp = v.get("lp") or v.get("last_price")
                    if not n or lp is None:
                        continue
                    out[n] = {
                        "lp": float(lp),
                        "chp": float(v.get("chp") or 0),
                        "ch": float(v.get("ch") or 0),
                        "prev_close": float(v.get("prev_close_price") or 0),
                        "name": v.get("short_name") or v.get("description") or n,
                    }
        return out

    @staticmethod
    def resample_weekly(df: pd.DataFrame) -> pd.DataFrame:
        return df.resample("W-FRI").agg(
            {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
        ).dropna()

    @staticmethod
    def resample_monthly(df: pd.DataFrame) -> pd.DataFrame:
        return df.resample("ME").agg(
            {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
        ).dropna()
