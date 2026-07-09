"""
Fyers daily auto-login (TOTP).

Fyers disabled the refresh-token API (SEBI), so a fresh access token must be
minted by *logging in* each day. This automates that login end-to-end using the
TOTP 2FA secret — send-OTP → verify-TOTP → verify-PIN → auth-code → access token
— and persists the new token to .env. Run it once each morning (scheduled) and
the rest of the app (live prices, lot sizes) just works.

Required .env (all local, gitignored):
  CLIENT_APP_ID, APP_SECRET, REDIRECT_URI   (from your Fyers app)
  FYERS_ID                                  (your client id, e.g. XY12345)
  FYERS_TOTP_SECRET                         (the key behind your authenticator)
  FYERS_PIN                                 (your trading PIN)
"""
import base64
import os
import time
from urllib.parse import parse_qs, urlparse

import requests
from dotenv import set_key
from fyers_apiv3 import fyersModel

# Fyers login (vagator) service — separate host from the trading API.
_VAGATOR = "https://api-t2.fyers.in/vagator/v2"
_TOKEN_URL = "https://api-t1.fyers.in/api/v3/token"


def _b64(s: str) -> str:
    return base64.b64encode(str(s).encode()).decode()


def _env_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")


def _cfg() -> dict:
    return {
        "app_id": os.getenv("CLIENT_APP_ID", "").strip(),
        "secret": os.getenv("APP_SECRET", "").strip(),
        "redirect": os.getenv("REDIRECT_URI", "").strip(),
        "fy_id": os.getenv("FYERS_ID", "").strip(),
        "totp": os.getenv("FYERS_TOTP_SECRET", "").strip().replace(" ", ""),
        "pin": os.getenv("FYERS_PIN", "").strip(),
    }


def _save_token(token: str) -> None:
    """Persist the access token to BOTH stores so a refresh always takes effect:
    - DB `config.fyers_token` (JSON-encoded) — what the app reads FIRST
      (FyersDownloader._load_access_token). If we only wrote .env, a token
      previously pasted via Settings would shadow every auto-login forever.
    - .env ACCESS_TOKEN — fallback + visibility for the CLI / scheduled task.
    """
    env = _env_path()
    set_key(env, "ACCESS_TOKEN", token)
    os.environ["ACCESS_TOKEN"] = token
    try:
        import json
        import sqlite3
        from .db import _get_db_path
        con = sqlite3.connect(_get_db_path(), timeout=15)
        con.execute(
            "INSERT INTO config (key, value) VALUES ('fyers_token', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [json.dumps(token)],
        )
        con.commit()
        con.close()
    except Exception:
        pass  # .env write already succeeded; DB is best-effort


def _effective_token() -> str:
    """The token the app actually uses: DB `config.fyers_token` first, else .env.
    Mirrors FyersDownloader._load_access_token so the badge/expiry match reality."""
    try:
        import json
        import sqlite3
        from .db import _get_db_path
        con = sqlite3.connect(_get_db_path(), timeout=15)
        row = con.execute("SELECT value FROM config WHERE key='fyers_token'").fetchone()
        con.close()
        if row and row[0]:
            tok = json.loads(row[0])
            if tok:
                return str(tok).strip()
    except Exception:
        pass
    from dotenv import load_dotenv
    load_dotenv(override=True)
    return os.getenv("ACCESS_TOKEN", "")


def auto_login() -> dict:
    """Run the full TOTP login. Returns {ok, message, step?}. Persists ACCESS_TOKEN."""
    c = _cfg()
    missing = [k for k in ("app_id", "secret", "redirect", "fy_id", "totp", "pin") if not c[k]]
    if missing:
        names = {"app_id": "CLIENT_APP_ID", "secret": "APP_SECRET", "redirect": "REDIRECT_URI",
                 "fy_id": "FYERS_ID", "totp": "FYERS_TOTP_SECRET", "pin": "FYERS_PIN"}
        return {"ok": False, "step": "config", "message": "Missing in .env: " + ", ".join(names[m] for m in missing)}

    try:
        import pyotp
    except ImportError:
        return {"ok": False, "step": "config", "message": "pyotp not installed (pip install pyotp)"}

    s = requests.Session()
    try:
        # 1) send login OTP (vagator wants the PLAIN fy_id)
        r = s.post(f"{_VAGATOR}/send_login_otp", json={"fy_id": c["fy_id"], "app_id": "2"}, timeout=15)
        rk = r.json().get("request_key")
        if not rk:
            return {"ok": False, "step": "send_otp", "message": str(r.json())[:200]}

        # 2) verify TOTP (retry once across a 30s rotation boundary)
        totp = pyotp.TOTP(c["totp"])
        r = s.post(f"{_VAGATOR}/verify_otp", json={"request_key": rk, "otp": totp.now()}, timeout=15)
        if not r.json().get("request_key"):
            time.sleep(1)
            r = s.post(f"{_VAGATOR}/verify_otp", json={"request_key": rk, "otp": totp.now()}, timeout=15)
        rk = r.json().get("request_key")
        if not rk:
            return {"ok": False, "step": "verify_otp", "message": str(r.json())[:200]}

        # 3) verify PIN -> login session token
        r = s.post(f"{_VAGATOR}/verify_pin", json={"request_key": rk, "identity_type": "pin", "identifier": c["pin"]}, timeout=15)
        login_token = (r.json().get("data") or {}).get("access_token")
        if not login_token:
            return {"ok": False, "step": "verify_pin", "message": str(r.json())[:200]}

        # 4) auth code
        app_short = c["app_id"].split("-")[0]
        app_type = c["app_id"].split("-")[1] if "-" in c["app_id"] else "100"
        r = s.post(
            _TOKEN_URL,
            headers={"authorization": f"Bearer {login_token}", "content-type": "application/json"},
            json={"fyers_id": c["fy_id"], "app_id": app_short, "redirect_uri": c["redirect"],
                  "appType": app_type, "code_challenge": "", "state": "auto", "scope": "",
                  "nonce": "", "response_type": "code", "create_cookie": True},
            timeout=15,
        )
        url = r.json().get("Url") or r.json().get("url")
        if not url:
            return {"ok": False, "step": "authcode", "message": str(r.json())[:200]}
        auth_code = parse_qs(urlparse(url).query).get("auth_code", [None])[0]
        if not auth_code:
            return {"ok": False, "step": "authcode", "message": "no auth_code in redirect URL"}

        # 5) exchange auth code -> access token
        return exchange_auth_code(auth_code)
    except Exception as exc:
        return {"ok": False, "step": "exception", "message": f"{type(exc).__name__}: {exc}"}


def exchange_auth_code(auth_code: str) -> dict:
    """Exchange a Fyers auth code for an access token; persist to .env. Manual fallback."""
    c = _cfg()
    if not (c["app_id"] and c["secret"] and c["redirect"]):
        return {"ok": False, "step": "config", "message": "Missing CLIENT_APP_ID / APP_SECRET / REDIRECT_URI"}
    try:
        session = fyersModel.SessionModel(
            client_id=c["app_id"], secret_key=c["secret"], redirect_uri=c["redirect"],
            response_type="code", grant_type="authorization_code",
        )
        session.set_token(auth_code)
        resp = session.generate_token()
        token = resp.get("access_token")
        if not token:
            return {"ok": False, "step": "exchange", "message": str(resp)[:200]}
        _save_token(token)
        if resp.get("refresh_token"):
            set_key(_env_path(), "REFRESH_TOKEN", resp["refresh_token"])
            os.environ["REFRESH_TOKEN"] = resp["refresh_token"]
        return {"ok": True, "message": "Access token refreshed and saved."}
    except Exception as exc:
        return {"ok": False, "step": "exchange", "message": f"{type(exc).__name__}: {exc}"}


def auth_url() -> str:
    """Browser login URL for the manual auth-code fallback."""
    c = _cfg()
    session = fyersModel.SessionModel(
        client_id=c["app_id"], secret_key=c["secret"], redirect_uri=c["redirect"],
        response_type="code", grant_type="authorization_code",
    )
    return session.generate_authcode()


def _token_expiry() -> "int | None":
    """Unix-epoch expiry decoded from the Fyers access token (a JWT). None if unparseable."""
    import base64
    import json
    tok = _effective_token()
    try:
        parts = tok.split(".")
        if len(parts) >= 2:
            pl = parts[1] + "=" * (-len(parts[1]) % 4)
            return json.loads(base64.urlsafe_b64decode(pl)).get("exp")
    except Exception:
        pass
    return None


def token_status() -> dict:
    """Whether the current ACCESS_TOKEN works, plus its expiry epoch for a countdown."""
    out: dict = {"expires_at": _token_expiry()}
    try:
        from .downloaders.fyers import FyersDownloader
        d = FyersDownloader()
        prof = d._fyers.get_profile()
        if isinstance(prof, dict) and prof.get("s") == "ok":
            name = (prof.get("data") or {}).get("name") or ""
            out.update({"connected": True, "message": f"Connected{(' as ' + name) if name else ''}"})
        else:
            out.update({"connected": False, "message": (prof or {}).get("message", "token invalid") if isinstance(prof, dict) else "token invalid"})
    except Exception as exc:
        out.update({"connected": False, "message": f"{type(exc).__name__}: {exc}"})
    return out
