import asyncio
import json
import os
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

from .db import _get_db_path


def _fetch_news(symbol: str, limit: int = 6) -> list[dict]:
    """Fetch recent headlines from Google News RSS. Returns list of {title, source, published}."""
    clean = symbol.replace("NSE:", "").replace("-EQ", "").replace("-INDEX", "")
    query = urllib.parse.quote(f"{clean} NSE India stock")
    url = f"https://news.google.com/rss/search?q={query}&hl=en-IN&gl=IN&ceid=IN:en"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            xml_data = resp.read()
        root = ET.fromstring(xml_data)
        headlines = []
        for item in root.findall("./channel/item")[:limit]:
            headlines.append({
                "title":     item.findtext("title", "").strip(),
                "source":    item.findtext("source", "").strip(),
                "published": item.findtext("pubDate", "").strip(),
            })
        return headlines
    except Exception:
        return []


def _call_openai(symbol: str, scan_date: str, details: dict, news: list[dict]) -> dict:
    """Call OpenAI gpt-4o-mini synchronously. Returns structured analysis dict."""
    from openai import OpenAI  # lazy import — only when API key present

    clean = symbol.replace("NSE:", "").replace("-EQ", "")
    news_text = (
        "\n".join(f"- {n['title']} ({n['source']}, {n['published']})" for n in news)
        or "No recent news found."
    )

    prompt = f"""You are an expert Indian equity market analyst.

Analyze the following **Tight Range** setup and respond with a JSON object only.

**Stock**: {clean} (NSE)  |  **Date**: {scan_date}

**Technical snapshot (last 30 daily candles)**:
- Price band compression: {details.get('band_pct', 'N/A')}%
- RSI(14): {details.get('rsi', 'N/A')}
- Volume (recent vs avg): {details.get('vol_ratio', 'N/A')}x  (slope: {details.get('volume_slope', 'N/A')})
- Big upper wick candles: {details.get('big_wick_ratio', 'N/A')}%
- Entry close: ₹{details.get('entry_close', 'N/A')}
- Stop loss (band low): ₹{details.get('stop_loss', 'N/A')}
- Band high (resistance): ₹{details.get('resistance', 'N/A')}

**Recent news**:
{news_text}

Respond with exactly this JSON (no markdown):
{{
  "technical_summary": "2–3 sentences on the technical setup quality",
  "news_summary": "1–2 sentences on how news supports or threatens the setup",
  "success_probability": 0.60,
  "failure_probability": 0.40,
  "reasoning": "3–4 sentences explaining probabilities given technicals + news",
  "target_price": 0.0,
  "support_price": 0.0
}}"""

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))
    try:
        resp = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=500,
        )
        return json.loads(resp.choices[0].message.content)
    except Exception as exc:
        return {
            "technical_summary": "Analysis unavailable.",
            "news_summary": "News unavailable.",
            "success_probability": 0.5,
            "failure_probability": 0.5,
            "reasoning": f"Error during analysis: {exc}",
            "target_price": 0.0,
            "support_price": 0.0,
        }


async def get_or_create_ai_analysis(
    scan_result_id: int,
    symbol: str,
    analysis_type: str,
    scan_date: str,
    details: Optional[dict],
) -> dict:
    """Return cached row or generate + store a new AI analysis."""
    db_path = _get_db_path()

    # Return cached if exists
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM ai_analysis WHERE symbol=? AND analysis_type=? AND scan_date=?",
            [symbol, analysis_type, scan_date],
        ) as cur:
            row = await cur.fetchone()
        if row:
            return _row_to_dict(row)

    # Fetch news and call OpenAI in thread pool
    news = await asyncio.to_thread(_fetch_news, symbol)
    result = await asyncio.to_thread(_call_openai, symbol, scan_date, details or {}, news)

    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            """INSERT INTO ai_analysis
               (scan_result_id, symbol, analysis_type, scan_date,
                news_headlines, technical_summary, success_probability,
                failure_probability, reasoning, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(symbol, analysis_type, scan_date) DO UPDATE SET
                 scan_result_id      = excluded.scan_result_id,
                 news_headlines      = excluded.news_headlines,
                 technical_summary   = excluded.technical_summary,
                 success_probability = excluded.success_probability,
                 failure_probability = excluded.failure_probability,
                 reasoning           = excluded.reasoning,
                 created_at          = excluded.created_at""",
            [
                scan_result_id, symbol, analysis_type, scan_date,
                json.dumps(news),
                result.get("technical_summary", ""),
                result.get("success_probability", 0.5),
                result.get("failure_probability", 0.5),
                json.dumps(result),
                now,
            ],
        )
        await db.commit()
        async with db.execute(
            "SELECT * FROM ai_analysis WHERE symbol=? AND analysis_type=? AND scan_date=?",
            [symbol, analysis_type, scan_date],
        ) as cur:
            row = await cur.fetchone()
        return _row_to_dict(row)


def _row_to_dict(row) -> dict:
    d = dict(row)
    # Parse JSON fields for the caller
    if d.get("news_headlines"):
        try:
            d["news_headlines"] = json.loads(d["news_headlines"])
        except Exception:
            d["news_headlines"] = []
    if d.get("reasoning"):
        try:
            d["reasoning_parsed"] = json.loads(d["reasoning"])
        except Exception:
            d["reasoning_parsed"] = {}
    return d
