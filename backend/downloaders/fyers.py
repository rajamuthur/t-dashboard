import hashlib
import os
import requests
import pandas as pd
from datetime import datetime
from dotenv import set_key, load_dotenv
from fyers_apiv3 import fyersModel


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
            con = sqlite3.connect(_get_db_path())
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
        rt  = os.getenv("REFRESH_TOKEN", "").strip("'\"")
        pin = os.getenv("FYERS_PIN", "")
        if not rt or not pin or not self._secret:
            return False
        h = hashlib.sha256(f"{self._app_id}:{self._secret}".encode()).hexdigest()
        resp = requests.post(
            "https://api-t1.fyers.in/api/v3/validate-refresh-token",
            headers={"Content-Type": "application/json"},
            json={"grant_type": "refresh_token", "appIdHash": h, "refresh_token": rt, "pin": pin},
            timeout=15,
        )
        if resp.status_code != 200:
            return False
        data = resp.json()
        if data.get("s") != "ok":
            return False
        new_token = data["access_token"]
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../.env")
        set_key(env_path, "ACCESS_TOKEN", new_token)
        if data.get("refresh_token"):
            set_key(env_path, "REFRESH_TOKEN", data["refresh_token"])
        os.environ["ACCESS_TOKEN"] = new_token
        self._fyers = self._build_client()
        return True

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
        """LTP for many symbols → {symbol: ltp}. Batches ≤50 per Fyers call."""
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
                        out[n] = float(lp)
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
