"""
Email (Gmail SMTP) and WhatsApp (CallMeBot) notification service.

Config is read from the `config` table at send time so changes take effect
without restart.
"""
import asyncio
import json
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional
from urllib.parse import quote

import aiosqlite
import requests

from .db import _get_db_path


async def _get_config(key: str) -> dict:
    async with aiosqlite.connect(_get_db_path()) as db:
        async with db.execute("SELECT value FROM config WHERE key=?", [key]) as cur:
            row = await cur.fetchone()
    return json.loads(row[0]) if row else {}


def _format_signal_text(signals: list[dict]) -> str:
    """Plain-text summary for WhatsApp / email body fallback."""
    lines = ["=== Fyers EOW Scanner Alert ===", ""]
    for s in signals:
        lines.append(f"Symbol : {s.get('symbol', '').replace('NSE:', '').replace('-EQ', '')}")
        lines.append(f"Date   : {s.get('candle_date', '')}")
        lines.append(f"Entry  : {s.get('entry_close', '')}")
        lines.append(f"SL     : {s.get('stop_loss', '')}")
        risk = abs((s.get("entry_close") or 0) - (s.get("stop_loss") or 0))
        lines.append(f"Risk   : {risk:.2f}")
        lines.append("")
    lines.append("Trade safe!")
    return "\n".join(lines)


def _format_signal_html(signals: list[dict]) -> str:
    rows = ""
    for s in signals:
        sym = s.get("symbol", "").replace("NSE:", "").replace("-EQ", "")
        entry = s.get("entry_close") or 0
        sl    = s.get("stop_loss") or 0
        risk  = abs(entry - sl)
        rows += f"""
        <tr>
          <td style="padding:8px;border:1px solid #374151;font-weight:bold;color:#60a5fa">{sym}</td>
          <td style="padding:8px;border:1px solid #374151;color:#d1d5db">{s.get('candle_date','')}</td>
          <td style="padding:8px;border:1px solid #374151;color:#34d399;text-align:right">{entry:.2f}</td>
          <td style="padding:8px;border:1px solid #374151;color:#f87171;text-align:right">{sl:.2f}</td>
          <td style="padding:8px;border:1px solid #374151;color:#9ca3af;text-align:right">{risk:.2f}</td>
        </tr>"""
    return f"""
    <div style="font-family:Arial,sans-serif;background:#111827;color:#f9fafb;padding:24px;border-radius:12px">
      <h2 style="color:#60a5fa;margin-top:0">Fyers EOW Scanner Alert</h2>
      <p style="color:#9ca3af">3-Candle Reversal pattern detected on weekly timeframe</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <thead>
          <tr style="background:#1f2937">
            <th style="padding:8px;border:1px solid #374151;text-align:left;color:#9ca3af">Symbol</th>
            <th style="padding:8px;border:1px solid #374151;text-align:left;color:#9ca3af">Week</th>
            <th style="padding:8px;border:1px solid #374151;text-align:right;color:#9ca3af">Entry</th>
            <th style="padding:8px;border:1px solid #374151;text-align:right;color:#9ca3af">Stop Loss</th>
            <th style="padding:8px;border:1px solid #374151;text-align:right;color:#9ca3af">Risk</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      <p style="color:#6b7280;font-size:12px;margin-top:16px">
        Entry on Monday open. Check for gap-up before placing order.
      </p>
    </div>"""


async def send_email(signals: list[dict]) -> dict:
    """Send Gmail SMTP notification. Returns {ok, error}."""
    cfg = await _get_config("email_config")
    if not cfg.get("username") or not cfg.get("password"):
        return {"ok": False, "error": "Email not configured"}
    if not cfg.get("to_addresses"):
        return {"ok": False, "error": "No recipients configured"}

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"EOW Alert: {len(signals)} signal(s) detected"
    msg["From"]    = f"{cfg.get('from_name', 'Fyers Scanner')} <{cfg['username']}>"
    msg["To"]      = ", ".join(cfg["to_addresses"])

    msg.attach(MIMEText(_format_signal_text(signals), "plain"))
    msg.attach(MIMEText(_format_signal_html(signals), "html"))

    try:
        context = ssl.create_default_context()
        with smtplib.SMTP(cfg.get("smtp_host", "smtp.gmail.com"),
                          int(cfg.get("smtp_port", 587))) as server:
            server.starttls(context=context)
            server.login(cfg["username"], cfg["password"])
            server.sendmail(cfg["username"], cfg["to_addresses"], msg.as_string())
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


async def send_whatsapp(signals: list[dict]) -> dict:
    """Send WhatsApp via CallMeBot API to all configured recipients."""
    cfg = await _get_config("whatsapp_config")
    recipients = cfg.get("recipients", [])
    if not recipients:
        return {"ok": False, "error": "No WhatsApp recipients configured"}

    text = _format_signal_text(signals)
    results = []
    for r in recipients:
        phone  = str(r.get("phone", "")).strip()
        apikey = str(r.get("apikey", "")).strip()
        if not phone or not apikey:
            results.append({"phone": phone, "ok": False, "error": "Missing phone/apikey"})
            continue
        url = (
            f"https://api.callmebot.com/whatsapp.php"
            f"?phone={phone}&text={quote(text)}&apikey={apikey}"
        )
        try:
            resp = await asyncio.to_thread(
                lambda u=url: requests.get(u, timeout=15)
            )
            ok = resp.status_code == 200 and "Message Sent" in resp.text
            results.append({"phone": phone, "ok": ok,
                             "error": None if ok else resp.text[:200]})
        except Exception as exc:
            results.append({"phone": phone, "ok": False, "error": str(exc)})

    all_ok = all(r["ok"] for r in results)
    return {"ok": all_ok, "results": results}


async def notify_signals(signals: list[dict]) -> dict:
    """Send both email and WhatsApp notifications. Returns combined result."""
    if not signals:
        return {"email": {"ok": True, "skipped": True},
                "whatsapp": {"ok": True, "skipped": True}}

    cfg = await _get_config("eow_config")
    email_result     = {"ok": True, "skipped": True}
    whatsapp_result  = {"ok": True, "skipped": True}

    if cfg.get("notify_email", True):
        email_result = await send_email(signals)
    if cfg.get("notify_whatsapp", True):
        whatsapp_result = await send_whatsapp(signals)

    return {"email": email_result, "whatsapp": whatsapp_result}
