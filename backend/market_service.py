"""
NSE index snapshot (NIFTY 50 / NIFTY BANK) — value, points change, % change.
Used by the header ticker (/market/indices) and the market-open / EOD P&L briefs.
"""
INDEX_SYMBOLS = [
    ("NIFTY 50", "NSE:NIFTY50-INDEX"),
    ("NIFTY BANK", "NSE:NIFTYBANK-INDEX"),
]


def index_snapshot() -> list[dict]:
    """Live [{name, symbol, lp, ch, chp}] for the headline indices. lp/ch/chp are
    None if the quote is unavailable (e.g. Fyers token down)."""
    from .downloaders.fyers import FyersDownloader
    q = FyersDownloader().quotes_full([s for _, s in INDEX_SYMBOLS])
    out = []
    for name, sym in INDEX_SYMBOLS:
        info = q.get(sym) or {}
        out.append({
            "name": name, "symbol": sym,
            "lp": info.get("lp"), "ch": info.get("ch"), "chp": info.get("chp"),
        })
    return out


def index_summary_line(indices: list[dict]) -> str:
    """Plain-text one-liner-per-index for Telegram captions, e.g.
    'NIFTY 50  24,570.65  ▲ +120.30 (+0.49%)'."""
    lines = []
    for ix in indices:
        if ix.get("lp") is None:
            lines.append(f"{ix['name']}  —")
            continue
        ch = ix.get("ch") or 0.0
        chp = ix.get("chp") or 0.0
        arrow = "▲" if ch >= 0 else "▼"
        lines.append(f"{ix['name']}  {ix['lp']:,.2f}  {arrow} {ch:+,.2f} ({chp:+.2f}%)")
    return "\n".join(lines)
