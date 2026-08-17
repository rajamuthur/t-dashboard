"""
Render the EOD P&L summary as a clean, color-coded table image (PNG) for Telegram
— a mini dashboard instead of a wall of text. Headless matplotlib (Agg).
"""
from io import BytesIO
from typing import Optional

import matplotlib
matplotlib.use("Agg")  # headless
import matplotlib.pyplot as plt  # noqa: E402

_COLS = ["Symbol", "Side/Qty", "Entry", "LTP", "P&L", "P&L %", "Chg %", "Held", "Since", "Expiry"]
_WIDTHS = [0.20, 0.10, 0.08, 0.08, 0.10, 0.075, 0.075, 0.085, 0.095, 0.11]

_POS = "#15803d"   # green text
_NEG = "#b91c1c"   # red text
_HDR_BG = "#0f172a"
_SECTION_BG = "#e0e7ff"
_NET_BG = "#0f172a"
_SUBTOTAL_BG = "#f1f5f9"
_ROW_A = "#ffffff"
_ROW_B = "#f8fafc"


def _money(v: float) -> str:
    return f"{'+' if v >= 0 else '−'}{abs(round(v)):,.0f}"


def _pct(v: Optional[float]) -> str:
    return "—" if v is None else f"{'+' if v >= 0 else '−'}{abs(round(v, 2))}%"


def render_eod_table_png(title: str, sections: list[dict], net_pnl: float) -> Optional[bytes]:
    """sections: [{book, rows:[rowdict], subtotal}]; rowdict keys: symbol, side, qty,
    entry, ltp, pnl, pnl_pct, chg, held, expiry_td, expiry_warn."""
    # Flatten into display rows, remembering per-row styling.
    disp: list[tuple[list[str], str, dict]] = []  # (cells, kind, meta)
    for sec in sections:
        book = sec["book"]
        disp.append(([book.upper()] + [""] * 9, "section", {}))
        for r in sec["rows"]:
            cells = [
                r["symbol"],
                f"{(r.get('side') or '').upper()} {r['qty']}",
                f"{r['entry']:,.2f}",
                f"{r['ltp']:,.2f}",
                _money(r["pnl"]),
                _pct(r["pnl_pct"]),
                _pct(r.get("chg")),
                r.get("held", "—"),
                r.get("entered", "—"),
                (r.get("expiry") or "—"),
            ]
            disp.append((cells, "pos", {
                "pnl": r["pnl"] >= 0, "chg": (r.get("chg") or 0) >= 0,
                "expiry_warn": bool(r.get("expiry_warn")),
            }))
        disp.append(([f"Subtotal · {book}", "", "", "", _money(sec["subtotal"]), "", "", "", "", ""],
                     "subtotal", {"pnl": sec["subtotal"] >= 0}))
    disp.append((["NET  (both books)", "", "", "", _money(net_pnl), "", "", "", "", ""],
                 "net", {"pnl": net_pnl >= 0}))

    n = len(disp)
    fig_h = 0.9 + 0.34 * (n + 1)
    fig, ax = plt.subplots(figsize=(11.5, fig_h))
    ax.axis("off")
    ax.set_title(title, fontsize=13, fontweight="bold", loc="left", color="#0f172a", pad=12)

    tbl = ax.table(cellText=[d[0] for d in disp], colLabels=_COLS,
                   colWidths=_WIDTHS, loc="center", cellLoc="center")
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(9.5)
    tbl.scale(1, 1.55)

    ncol = len(_COLS)
    # Header row (row 0).
    for j in range(ncol):
        c = tbl[0, j]
        c.set_facecolor(_HDR_BG)
        c.set_edgecolor("#0f172a")
        t = c.get_text()
        t.set_color("white")
        t.set_fontweight("bold")

    for i, (cells, kind, meta) in enumerate(disp, start=1):
        for j in range(ncol):
            cell = tbl[i, j]
            cell.set_edgecolor("#e2e8f0")
            txt = cell.get_text()
            # left-align the Symbol column, center the rest
            if j == 0:
                txt.set_ha("left")
                cell.PAD = 0.03
            if kind == "section":
                cell.set_facecolor(_SECTION_BG)
                txt.set_color("#3730a3")
                txt.set_fontweight("bold")
            elif kind == "subtotal":
                cell.set_facecolor(_SUBTOTAL_BG)
                txt.set_fontstyle("italic")
                txt.set_fontweight("bold")
                if j == 4:
                    txt.set_color(_POS if meta.get("pnl") else _NEG)
            elif kind == "net":
                cell.set_facecolor(_NET_BG)
                txt.set_color("white")
                txt.set_fontweight("bold")
            else:  # position row
                cell.set_facecolor(_ROW_A if i % 2 else _ROW_B)
                if j in (4, 5):
                    txt.set_color(_POS if meta.get("pnl") else _NEG)
                elif j == 6:
                    txt.set_color(_POS if meta.get("chg") else _NEG)
                elif j == 9 and meta.get("expiry_warn"):
                    txt.set_color(_NEG)
                    txt.set_fontweight("bold")

    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()
