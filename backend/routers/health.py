"""
Health-check and Fyers token management.

All token mutations write to .env AND update os.environ so the running
process (and any FyersDownloader instantiated next) sees the new values
without requiring a restart.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlencode

import aiosqlite
import requests
from dotenv import load_dotenv, set_key
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import get_current_user
from ..db import _get_db_path

router = APIRouter(prefix="/health", tags=["health"])

# Load .env into os.environ at import time (db.py already does this, but be safe).
load_dotenv()

_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _fyers_login_url() -> str:
    """Construct the Fyers OAuth login URL from env config — no hardcoding."""
    client_id     = os.getenv("CLIENT_APP_ID", "").strip()
    redirect_uri  = os.getenv("REDIRECT_URI", "").strip()
    auth_code_url = os.getenv("AUTH_CODE_URL", "").strip()
    if not (client_id and redirect_uri and auth_code_url):
        raise RuntimeError(
            "CLIENT_APP_ID, REDIRECT_URI, and AUTH_CODE_URL must all be set in .env"
        )
    params = {
        "client_id":     client_id,
        "redirect_uri":  redirect_uri,
        "response_type": "code",
        "state":         "sample_state",
    }
    return f"{auth_code_url}?{urlencode(params)}"


def _app_id_hash() -> str:
    client_id  = os.getenv("CLIENT_APP_ID", "")
    app_secret = os.getenv("APP_SECRET", "")
    if not (client_id and app_secret):
        raise RuntimeError("CLIENT_APP_ID and APP_SECRET must be set in .env")
    return hashlib.sha256(f"{client_id}:{app_secret}".encode()).hexdigest()


def _persist_tokens(access_token: Optional[str], refresh_token: Optional[str]) -> None:
    """Write new tokens to .env and mirror them into os.environ for this process."""
    if access_token:
        os.environ["ACCESS_TOKEN"] = access_token
        if _ENV_PATH.exists():
            set_key(str(_ENV_PATH), "ACCESS_TOKEN", access_token)
    if refresh_token:
        os.environ["REFRESH_TOKEN"] = refresh_token
        if _ENV_PATH.exists():
            set_key(str(_ENV_PATH), "REFRESH_TOKEN", refresh_token)


def _test_fyers_token() -> dict:
    """Lightweight call that returns {ok, message}. Uses get_profile()."""
    try:
        # Late import so a missing package doesn't fail module load
        from fyers_apiv3 import fyersModel
        client_id    = os.getenv("CLIENT_APP_ID", "")
        access_token = os.getenv("ACCESS_TOKEN", "")
        if not (client_id and access_token):
            return {"ok": False, "message": "CLIENT_APP_ID or ACCESS_TOKEN not set"}
        fy = fyersModel.FyersModel(client_id=client_id, token=access_token, is_async=False)
        resp = fy.get_profile()
        if isinstance(resp, dict) and resp.get("s") == "ok":
            name = (resp.get("data") or {}).get("name") or "authenticated"
            return {"ok": True, "message": f"Fyers token valid ({name})"}
        msg = resp.get("message") if isinstance(resp, dict) else str(resp)
        return {"ok": False, "message": f"Fyers rejected token: {msg}"}
    except Exception as exc:
        return {"ok": False, "message": f"Fyers call failed: {exc}"}


async def _check_db() -> dict:
    try:
        async with aiosqlite.connect(_get_db_path()) as db:
            async with db.execute("SELECT 1") as cur:
                await cur.fetchone()
        return {"ok": True, "message": f"SQLite reachable at {_get_db_path()}"}
    except Exception as exc:
        return {"ok": False, "message": f"DB error: {exc}"}


async def _check_data_freshness() -> dict:
    """Report age of the latest weekly candle — stale data usually means auth is expired."""
    try:
        async with aiosqlite.connect(_get_db_path()) as db:
            async with db.execute(
                "SELECT MAX(date) FROM candles WHERE timeframe='week'"
            ) as cur:
                row = await cur.fetchone()
        latest = row[0] if row else None
        if not latest:
            return {"ok": False, "message": "No weekly candles in DB"}
        latest_date = date.fromisoformat(latest[:10])
        age_days = (date.today() - latest_date).days
        ok = age_days <= 14  # within 2 weeks is considered fresh
        return {
            "ok": ok,
            "message": f"Latest weekly candle: {latest} ({age_days} days old)",
        }
    except Exception as exc:
        return {"ok": False, "message": f"Freshness check failed: {exc}"}


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@router.get("")
async def run_health_check(_: str = Depends(get_current_user)) -> dict[str, Any]:
    """Run all health checks and return per-check results."""
    db_check        = await _check_db()
    freshness_check = await _check_data_freshness()
    fyers_check     = await asyncio.to_thread(_test_fyers_token)

    checks = [
        {"name": "Database",       **db_check},
        {"name": "Fyers token",    **fyers_check},
        {"name": "Data freshness", **freshness_check},
    ]
    overall = "ok" if all(c["ok"] for c in checks) else "fail"
    return {
        "overall":    overall,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "checks":     checks,
    }


@router.get("/fyers-login-url")
async def get_fyers_login_url(_: str = Depends(get_current_user)) -> dict:
    """Return the Fyers OAuth URL to visit + notes for the user."""
    try:
        url = _fyers_login_url()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {
        "login_url":    url,
        "redirect_uri": os.getenv("REDIRECT_URI", ""),
        "instructions": (
            "1. Open login_url, log in to Fyers, complete 2FA.\n"
            "2. You'll be redirected to redirect_uri with ?auth_code=... in the URL.\n"
            "3. Copy the auth_code value and paste it back here."
        ),
    }


class AuthCodeBody(BaseModel):
    auth_code: str


@router.post("/exchange-auth-code")
async def exchange_auth_code(
    body: AuthCodeBody,
    _: str = Depends(get_current_user),
) -> dict:
    """Exchange a Fyers auth_code for access/refresh tokens and persist them."""
    validate_url = os.getenv("VALIDATE_URL", "").strip()
    if not validate_url:
        raise HTTPException(status_code=500, detail="VALIDATE_URL not set in .env")
    try:
        payload = {
            "grant_type": "authorization_code",
            "appIdHash":  _app_id_hash(),
            "code":       body.auth_code.strip(),
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    def _call() -> dict:
        resp = requests.post(validate_url, json=payload,
                             headers={"Content-Type": "application/json"},
                             timeout=20)
        try:
            data = resp.json()
        except ValueError:
            data = {"raw": resp.text}
        return {"status": resp.status_code, "body": data}

    result = await asyncio.to_thread(_call)
    body_j = result["body"]
    if result["status"] == 200 and body_j.get("s") == "ok":
        access  = body_j.get("access_token")
        refresh = body_j.get("refresh_token")
        _persist_tokens(access, refresh)
        probe = await asyncio.to_thread(_test_fyers_token)
        return {
            "ok":            True,
            "message":       "Tokens updated and persisted to .env",
            "token_preview": (access or "")[:12] + "…",
            "verify":        probe,
        }
    raise HTTPException(
        status_code=400,
        detail=f"Fyers rejected auth_code: {body_j}",
    )


@router.post("/refresh-token")
async def refresh_token(_: str = Depends(get_current_user)) -> dict:
    """Use stored REFRESH_TOKEN + FYERS_PIN to mint a new access token."""
    refresh_tok = (os.getenv("REFRESH_TOKEN") or "").strip("'\"")
    pin         = (os.getenv("FYERS_PIN") or "").strip()
    refresh_url = os.getenv("VALIDATE_REFRESH_URL", "").strip()
    if not (refresh_tok and pin and refresh_url):
        raise HTTPException(
            status_code=400,
            detail="REFRESH_TOKEN, FYERS_PIN, and VALIDATE_REFRESH_URL must all be set in .env",
        )
    try:
        payload = {
            "grant_type":    "refresh_token",
            "appIdHash":     _app_id_hash(),
            "refresh_token": refresh_tok,
            "pin":           pin,
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    def _call() -> dict:
        resp = requests.post(refresh_url, json=payload,
                             headers={"Content-Type": "application/json"},
                             timeout=20)
        try:
            data = resp.json()
        except ValueError:
            data = {"raw": resp.text}
        return {"status": resp.status_code, "body": data}

    result = await asyncio.to_thread(_call)
    body_j = result["body"]
    if result["status"] == 200 and body_j.get("s") == "ok":
        access  = body_j.get("access_token")
        new_ref = body_j.get("refresh_token")
        _persist_tokens(access, new_ref)
        probe = await asyncio.to_thread(_test_fyers_token)
        return {
            "ok":            True,
            "message":       "Access token refreshed and persisted to .env",
            "token_preview": (access or "")[:12] + "…",
            "verify":        probe,
        }
    raise HTTPException(
        status_code=400,
        detail=f"Refresh failed: {body_j}",
    )


class AccessTokenBody(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None


@router.post("/set-access-token")
async def set_access_token(
    body: AccessTokenBody,
    _: str = Depends(get_current_user),
) -> dict:
    """Directly persist a user-supplied access token (and optional refresh token)."""
    access = body.access_token.strip()
    if not access:
        raise HTTPException(status_code=400, detail="access_token is required")
    refresh = (body.refresh_token or "").strip() or None
    _persist_tokens(access, refresh)
    probe = await asyncio.to_thread(_test_fyers_token)
    return {
        "ok":            probe["ok"],
        "message":       "Token persisted to .env" if probe["ok"] else probe["message"],
        "token_preview": access[:12] + "…",
        "verify":        probe,
    }
