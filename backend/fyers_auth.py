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

_BASE = "https://api-t1.fyers.in/api/v3"


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
        # 1) send login OTP
        r = s.post(f"{_BASE}/send_login_otp_v2", json={"fy_id": _b64(c["fy_id"]), "app_id": "2"}, timeout=15)
        rk = r.json().get("request_key")
        if not rk:
            return {"ok": False, "step": "send_otp", "message": str(r.json())[:200]}

        # 2) verify TOTP (retry once across a 30s rotation boundary)
        totp = pyotp.TOTP(c["totp"])
        r = s.post(f"{_BASE}/verify_otp", json={"request_key": rk, "otp": totp.now()}, timeout=15)
        if not r.json().get("request_key"):
            time.sleep(1)
            r = s.post(f"{_BASE}/verify_otp", json={"request_key": rk, "otp": totp.now()}, timeout=15)
        rk = r.json().get("request_key")
        if not rk:
            return {"ok": False, "step": "verify_otp", "message": str(r.json())[:200]}

        # 3) verify PIN -> login session token
        r = s.post(f"{_BASE}/verify_pin", json={"request_key": rk, "identity_type": "pin", "identifier": _b64(c["pin"])}, timeout=15)
        login_token = (r.json().get("data") or {}).get("access_token")
        if not login_token:
            return {"ok": False, "step": "verify_pin", "message": str(r.json())[:200]}

        # 4) auth code
        app_short = c["app_id"].split("-")[0]
        app_type = c["app_id"].split("-")[1] if "-" in c["app_id"] else "100"
        r = s.post(
            f"{_BASE}/token",
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
        env = _env_path()
        set_key(env, "ACCESS_TOKEN", token)
        os.environ["ACCESS_TOKEN"] = token
        if resp.get("refresh_token"):
            set_key(env, "REFRESH_TOKEN", resp["refresh_token"])
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


def token_status() -> dict:
    """Lightweight check whether the current ACCESS_TOKEN works."""
    try:
        from .downloaders.fyers import FyersDownloader
        d = FyersDownloader()
        prof = d._fyers.get_profile()
        if isinstance(prof, dict) and prof.get("s") == "ok":
            name = (prof.get("data") or {}).get("name") or ""
            return {"connected": True, "message": f"Connected{(' as ' + name) if name else ''}"}
        return {"connected": False, "message": (prof or {}).get("message", "token invalid") if isinstance(prof, dict) else "token invalid"}
    except Exception as exc:
        return {"connected": False, "message": f"{type(exc).__name__}: {exc}"}
