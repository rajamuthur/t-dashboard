# Trade Like a Stock Market Wizard — Methodology Reference

> Mark Minervini · McGraw-Hill, 2013. Distilled for the pattern-scanner work in this
> project. This is a **methodology summary**, not a substitute for the book. Page/quote
> references are approximate (extracted from the PDF). Focus: the rules we encode in the
> VCP scanner and the Trend Template gate.

---

## 1. The SEPA® framework (the big picture)

Minervini's strategy is **SEPA** — *Specific Entry Point Analysis*. It ranks candidates on
five elements, in priority order:

1. **Trend** — the stock must already be in a confirmed Stage 2 uptrend (see §2). This is
   non-negotiable. *No Stage 2 → no trade.*
2. **Fundamentals** — accelerating earnings/sales/margins, ideally a surprise catalyst.
3. **Catalyst** — a reason institutions are buying (new product, new management, sector
   tailwind).
4. **Entry point** — a precise, low-risk pivot (this is where VCP lives, §3).
5. **Exit point** — predefined stop and profit-taking plan *before* entry (§4).

> In this project we can only measure **Trend** and **Entry point** from price/volume data.
> Fundamentals/catalyst are out of scope (no earnings feed). So our scanner enforces the
> Trend Template as a hard gate and detects the VCP entry — and is explicit that the
> fundamental leg is the user's job.

---

## 2. Stage Analysis & the Trend Template

Minervini divides a stock's life into four stages (after Stan Weinstein):

| Stage | Name | Character | Action |
|---|---|---|---|
| 1 | Neglect / basing | Sideways after a decline | Wait |
| **2** | **Advancing** | **Uptrend, higher highs/lows, above rising MAs** | **Buy zone** |
| 3 | Topping | Churning, distribution | Take profits |
| 4 | Declining | Downtrend | Avoid / short |

**You only buy in Stage 2.** The **Trend Template** is the objective filter that confirms
Stage 2. All eight criteria must be true:

1. Current price is **above** both the 150-day (30-week) and 200-day (40-week) moving
   averages.
2. The **150-day MA is above the 200-day MA**.
3. The **200-day MA is trending up** for at least 1 month (preferably 4–5+ months).
4. The **50-day (10-week) MA is above both the 150-day and 200-day** MAs.
5. The current price is **above the 50-day MA**.
6. The current price is **at least 25–30% above its 52-week low** (Minervini cites 30%;
   ideally much more).
7. The current price is **within 25% of its 52-week high** (the closer the better).
8. The **relative-strength (RS) rank is ≥ 70** (vs. the broad market — IBD-style), ideally
   80–90+, and improving.

> **Implementation note:** criteria 1–7 are computable from OHLCV alone and are the gate
> in `backend/scanners/vcp.py`. Criterion 8 (RS rank) needs a market-relative ranking
> universe we don't have, so the scanner **skips RS rank** and documents that omission —
> it is the one Trend Template criterion not enforced.

---

## 3. The Volatility Contraction Pattern (VCP) — the entry

> *"If there is any one commonality or Holy Grail that I follow and practice regularly,
> it is the concept of volatility contraction."* (Ch. 10)

### 3.1 What it is
A VCP is a basing pattern where **volatility contracts from left to right** — the stock
moves from greater volatility on the left of the base to lesser volatility on the right,
with **volume drying up** at the tightest (rightmost) point. It establishes a **precise,
low-risk entry at the "line of least resistance."**

### 3.2 The contraction count
- A VCP shows **2 to 6 contractions** ("Ts"); **typically 2 to 4**.
- Each successive contraction is **about half (± a reasonable amount) of the previous
  pullback.** Classic progression: e.g. **25% → 15% → 8%**, or **25% → 10% → 5%**.
- Volatility (high-to-low of each pullback) is **greatest on the left** (sellers rushing
  out) and **shrinks on the right** as supply is absorbed.
- The **final contraction is tight** — often **~3–10%** — on **very low volume**. That
  low-volume tightness is the signal that *selling has dried up*.

### 3.3 The pivot and the buy
- The **pivot buy point** = the high of the **last (tightest) contraction**.
- **Buy on the breakout above the pivot**, and the breakout should come on
  **expanding volume** (demand returning). Volume **contracts** through the base, then
  **expands** on the breakout.
- Example from the book (Meridian Bioscience, VIVO): 4 contractions of
  31% → 17% → 8% → 3% over a 40-week base; bought the breakout above the final 3%
  pullback; advanced >100%.

### 3.4 The Technical Footprint
Minervini logs each base with a 3-part shorthand:

```
Time / Price / Symmetry      e.g.  "40W 31/3 4T"
```

- **Time** — how long the base is (days or weeks). *40W = 40 weeks.*
- **Price** — *largest correction / smallest (final) pullback*. *31/3 = deepest 31%,
  tightest 3%.*
- **Symmetry** — number of contractions. *4T = four "Ts".*

> **Implementation note:** our scanner emits this footprint (`weeks`, `deepest_pct`,
> `tightest_pct`, `t_count`) so each VCP detection carries its Minervini signature.

### 3.5 Variations that are NOT a classic VCP
- **Flat base / Darvas box** — 4–7 weeks, tight 10–15% sideways range, *no real
  contraction*. Valid base, but not a VCP.
- Patterns where pullbacks don't progressively tighten.

---

## 4. Risk management — the non-negotiables

### 4.1 The initial stop-loss
- Set a **maximum stop-loss before buying** — the price at which you exit if it moves
  against you. *"The moment the price hits the stop loss, I sell the position without
  hesitation."*
- The initial stop matters most **early** in the trade. Once the stock advances, **raise
  the sell point** with a **trailing stop / back stop** to protect profit.

### 4.2 Buy near the "danger point"
- Enter **as close to the stop as possible** so risk per share is small. The VCP pivot is
  exactly such a low-risk entry: the tight final contraction puts a logical stop just
  below it.
- *"You don't control risk when you sell, you control it when you buy."* Ask: can you
  afford a 25% loss for a 10–15% expected gain? Always want **reward > risk**.

### 4.3 Selling into strength
- Once a gain is a **multiple of your stop** (e.g. stop 7%, gain 20%+), **never let that
  winner turn into a loss** — move the stop to breakeven or trail it.

### 4.4 The reentry
- Getting stopped out in a whipsaw market is normal. If the stock still has winning
  characteristics, **look for a reentry** — the second base is often **stronger** than the
  first (weak holders shaken out). It can take 2–3 tries to catch a big winner.

---

## 5. How this maps to our scanner

| Book concept | Where it lives in code |
|---|---|
| Trend Template (criteria 1–7) | Hard gate in `backend/scanners/vcp.py` (`_trend_template`) |
| RS rank (criterion 8) | **Skipped** — no market-relative universe; documented |
| 2–6 contractions, each ~half prior | Contraction-detection loop |
| Volume dry-up at the tightest point | Volume-trend check on the final contraction |
| Pivot = high of last contraction | `pivot` / `breakout_level` |
| Buy on breakout, expanding volume | `entry_mode: "breakout"`, breakout-confirmed outcome eval |
| Footprint `Time/Price/Symmetry` | `weeks`, `deepest_pct`, `tightest_pct`, `t_count` in details |
| Stop just below final contraction | `stop_loss` |

See the companion doc [`minervini-think-and-trade-like-a-champion.md`](./minervini-think-and-trade-like-a-champion.md)
for the position-sizing and sell-discipline detail that complements this volume.
