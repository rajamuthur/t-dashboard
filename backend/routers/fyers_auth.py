"""Fyers connection endpoints — auto-login (TOTP), manual auth-code exchange, status."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import get_current_user
from ..fyers_auth import auto_login, exchange_auth_code, auth_url, token_status

router = APIRouter(prefix="/fyers", tags=["fyers"])


@router.get("/status")
async def status(_: str = Depends(get_current_user)):
    return await asyncio.to_thread(token_status)


@router.get("/auth-url")
async def get_auth_url(_: str = Depends(get_current_user)):
    try:
        return {"url": await asyncio.to_thread(auth_url)}
    except Exception as exc:
        raise HTTPException(400, f"Could not build auth URL: {exc}")


@router.post("/login")
async def login(_: str = Depends(get_current_user)):
    """Run the full TOTP auto-login and persist a fresh access token."""
    res = await asyncio.to_thread(auto_login)
    if not res.get("ok"):
        raise HTTPException(400, res.get("message", "login failed"))
    return res


class ExchangeBody(BaseModel):
    auth_code: str


@router.post("/exchange")
async def exchange(body: ExchangeBody, _: str = Depends(get_current_user)):
    res = await asyncio.to_thread(exchange_auth_code, body.auth_code.strip())
    if not res.get("ok"):
        raise HTTPException(400, res.get("message", "exchange failed"))
    return res
