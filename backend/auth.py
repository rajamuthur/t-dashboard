from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel
import os
import secrets

# ---------------------------------------------------------------------------
# Secrets / credentials are sourced from env vars.
# In ENV=production a real JWT_SECRET MUST be set (else login is disabled).
# In local dev we mint an ephemeral random secret so old tokens stop working
# on every restart — never hardcode a default.
# ---------------------------------------------------------------------------
_ENV = (os.getenv("ENV") or "development").lower()
_IS_PROD = _ENV in ("prod", "production")

_RAW_SECRET = os.getenv("JWT_SECRET", "").strip()
if _IS_PROD and not _RAW_SECRET:
    # Refuse to serve auth in prod without a real secret — fail closed.
    SECRET_KEY: str | None = None
else:
    SECRET_KEY = _RAW_SECRET or secrets.token_urlsafe(48)

ALGORITHM = "HS256"
_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))

# Single-user app: admin creds via env. Falls back to raja/raja ONLY in dev.
_USERNAME = os.getenv("ADMIN_USERNAME") or ("raja" if not _IS_PROD else "")
_PASSWORD = os.getenv("ADMIN_PASSWORD") or ("raja" if not _IS_PROD else "")

router = APIRouter(tags=["auth"])
_security = HTTPBearer()


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


def _require_secret() -> str:
    if not SECRET_KEY:
        raise HTTPException(
            status_code=503,
            detail="Auth not configured: set JWT_SECRET (and ADMIN_USERNAME/ADMIN_PASSWORD) on the server.",
        )
    return SECRET_KEY


def _make_token(username: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=_EXPIRE_HOURS)
    return jwt.encode({"sub": username, "exp": exp}, _require_secret(), algorithm=ALGORITHM)


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_security),
) -> str:
    try:
        payload = jwt.decode(creds.credentials, _require_secret(), algorithms=[ALGORITHM])
        username: str = payload.get("sub", "")
        if not _USERNAME or username != _USERNAME:
            raise HTTPException(status_code=401, detail="Invalid token")
        return username
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    # Constant-time compare to avoid leaking creds via timing.
    user_ok = bool(_USERNAME) and secrets.compare_digest(body.username, _USERNAME)
    pass_ok = bool(_PASSWORD) and secrets.compare_digest(body.password, _PASSWORD)
    if not (user_ok and pass_ok):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return TokenResponse(access_token=_make_token(body.username))


@router.get("/me")
async def me(username: str = Depends(get_current_user)):
    return {"username": username}
