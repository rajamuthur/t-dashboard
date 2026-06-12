"""
Telegram Bot notification service.

Sends messages via the Bot API `sendMessage` endpoint. Bot token + chat id are
read from the `config` table (key `telegram_config`) at send time, so changes
take effect without a restart. No automated/scheduled sending — callers invoke
send_message() explicitly (e.g. the /telegram/send endpoint).
"""
import json
from typing import Optional

import aiosqlite
import httpx

from .db import _get_db_path

TELEGRAM_API = "https://api.telegram.org"
# Telegram hard-caps a single message at 4096 chars.
_MAX_LEN = 4000


async def get_telegram_config() -> dict:
    async with aiosqlite.connect(_get_db_path()) as db:
        async with db.execute(
            "SELECT value FROM config WHERE key='telegram_config'"
        ) as cur:
            row = await cur.fetchone()
    return json.loads(row[0]) if row else {}


async def send_message(text: str, chat_id: Optional[str] = None) -> dict:
    """Send a Telegram message. Returns {ok, error?}.

    Uses HTML parse mode. Long messages are split into ≤4000-char chunks so
    Telegram doesn't reject them.
    """
    cfg = await get_telegram_config()
    token = (cfg.get("bot_token") or "").strip()
    target = (chat_id or cfg.get("chat_id") or "").strip()

    if not token:
        return {"ok": False, "error": "Telegram bot token not configured"}
    if not target:
        return {"ok": False, "error": "Telegram chat id not configured"}

    chunks = _split(text, _MAX_LEN)
    url = f"{TELEGRAM_API}/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            for chunk in chunks:
                resp = await client.post(url, json={
                    "chat_id": target,
                    "text": chunk,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                })
                data = resp.json()
                if not data.get("ok"):
                    return {"ok": False, "error": data.get("description", resp.text[:300])}
        return {"ok": True, "chunks": len(chunks)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _split(text: str, limit: int) -> list[str]:
    """Split on line boundaries so HTML tags aren't cut mid-message."""
    if len(text) <= limit:
        return [text]
    out: list[str] = []
    buf = ""
    for line in text.split("\n"):
        if len(buf) + len(line) + 1 > limit:
            if buf:
                out.append(buf)
            buf = line
        else:
            buf = f"{buf}\n{line}" if buf else line
    if buf:
        out.append(buf)
    return out
