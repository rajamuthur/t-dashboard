# Think & Trade Like a Champion — Methodology Reference

> Mark Minervini · Access Publishing, 2017. The companion volume to *Trade Like a Stock
> Market Wizard*. This book is the **execution and discipline** half: position sizing,
> stop placement, when to sell, and trader psychology. This is a **methodology summary**
> for the project, not a substitute for the book. Quotes/sections are approximate
> (extracted from the PDF).

> Read alongside [`minervini-trade-like-a-wizard.md`](./minervini-trade-like-a-wizard.md),
> which covers the Trend Template and the VCP entry. This doc covers what happens
> **after** you have a valid setup.

---

## 1. Risk first, not return first

The central mindset shift: **think "risk first."** Most investors fixate on the upside and
never use stops; champions decide the loss they'll accept *before* they enter.

- *"Without a defined stop, you don't have a trade — you have a hope."*
- **Backing into risk:** the stop-loss is part of *selection*. Minervini won't buy a name
  unless it offers a **low-risk entry point** — entering close to the stop (the "danger
  point", §3) so risk per share is small.
- **Reward must exceed risk.** Don't risk a 25% loss for a 10–15% gain. Stack the odds in
  your favor over many trades and the edge compounds.

---

## 2. The contingency plan (decide before you buy)

Before entering, have answers to all five:

1. **Initial stop-loss** — the predetermined exit price if it moves against you. Sell the
   moment it's hit, *without question*.
2. **Reentry criteria** — if a strong-fundamental stock stops you out and resets, where do
   you get back in? (Often the second setup is stronger.)
3. **Selling at a profit** — once you have a decent gain (a multiple of your stop), **don't
   let a winner become a loser.** Move the stop to breakeven or trail it.
4. **Position sizing / reallocation** — how big, and when do you add or trim (§4).
5. **Catastrophic / fast-market plan** — how you act decisively under sudden pressure.

---

## 3. Stop-loss discipline

- **Set the stop before buying.** It is the *first* decision in every trade, every day.
- **Trade near the danger point.** Enter as close to the logical stop as possible — that's
  where a failed move shows its hand earliest and where risk per share is minimized. The
  VCP pivot (tight final contraction) is exactly such a point.
- **Sell even before the stop is hit** if price action turns abnormal — don't wait for the
  stop if the trade is clearly souring. Learn to distinguish **normal vs. abnormal**
  behavior.
- **Cut your loss small.** A 7% stop is a common reference. Small losses keep the
  arithmetic of recovery in your favor (a 50% loss needs a 100% gain to recover).
- **Raise the stop as the trade works** — initial stop → breakeven → trailing/back stop to
  lock in profit.

---

## 4. Position sizing for optimal results

- **No single position should be able to do serious damage.** Minervini caps individual
  position size and uses **progressive exposure** — start with a pilot/partial size and
  add only as the trade proves itself and shows profit.
- **Sizing is a function of your real results, not a fixed dogma.** He uses a
  **Result-Based Assumption Forecast (RBAF)**: from your *actual* average gain, average
  loss, batting average, and position size, compute how many trades you need to hit a
  target return — then adjust size or trade count accordingly.
  - Worked example from the book: a $200k account, **25% position size**, 14% avg gain,
    7% avg loss, 46% batting average → ~60 trades to reach a 40% annual return. Double the
    position size (50%) → only ~30 trades needed; halve it (12.5%) → ~120 trades.
- **Bigger size demands a tighter setup.** Concentrate into your best, lowest-risk ideas;
  don't over-diversify into mediocre ones.

---

## 5. When to sell

Two reasons to sell — and they're different:

- **Selling into strength (offensive).** Sell *some* into a sharp, climactic advance to
  lock gains while there's demand. Selling half after a strong run "equalizes the
  rationale" — you protect your psyche whether it keeps running or pulls back.
- **Selling into weakness (defensive).** Honor the stop; exit on abnormal price/volume
  action (heavy distribution, breakdown through support).
- **Never let a good profit round-trip into a loss.** Once a winner has run a multiple of
  the risk, the stop should never sit below breakeven.

---

## 6. The champion mindset

- **Consistency over being right.** You can be profitable at a **46% batting average** if
  your wins are larger than your losses. Edge = (avg win × win rate) vs (avg loss × loss
  rate), not raw accuracy.
- **Objectivity over ego.** Stops getting hit isn't failure; refusing to take a small loss
  is. Professionals are dispassionate — each setup is a fresh risk/reward decision.
- **Post-trade analysis.** Review every trade to find weaknesses and refine — the RBAF
  numbers tell you exactly which lever (size, frequency, win rate, loss size) to pull.

---

## 7. How this maps to our project

The scanner detects setups; **this book governs what you do with them.** In the VCP page
and Telegram signals we surface the data needed to apply these rules:

| Champion concept | Where it shows up |
|---|---|
| Stop set before entry, near danger point | `stop_loss` placed just below the final contraction / pivot |
| Reward must exceed risk | We show `entry`, `stop`, `target` → reward:risk is visible per signal |
| Don't let a winner turn into a loss | Outcome eval distinguishes success / failure / open / `no_trade` (breakout never confirmed) |
| Position sizing (RBAF) | Out of scope for the scanner — it's an account-level decision; doc'd here so the rule isn't lost |
| Sell into strength / weakness | `target` (strength) and `stop_loss` (weakness) levels on every signal |

> The scanner is a **candidate finder under the Trend Template gate**. Sizing, partial
> profit-taking, and reentry are discretionary decisions the trader makes with the levels
> the signal provides.
