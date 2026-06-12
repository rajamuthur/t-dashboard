/**
 * Lightweight market-hours helpers. Browser-only.
 * Returns whether a given market is currently open based on local wall-clock
 * time in that market's timezone. No public-holiday handling — too noisy here.
 */

export type MarketStatus = "open" | "closed";

function partsIn(tz: string): { dow: number; minutes: number } {
  // Intl gives us the weekday name + hour/minute in the target timezone.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  let weekday = "Mon", hour = 0, minute = 0;
  for (const p of parts) {
    if (p.type === "weekday") weekday = p.value;
    else if (p.type === "hour") hour = parseInt(p.value, 10) || 0;
    else if (p.type === "minute") minute = parseInt(p.value, 10) || 0;
  }
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: map[weekday] ?? 1, minutes: hour * 60 + minute };
}

function isWeekday(dow: number): boolean { return dow >= 1 && dow <= 5; }

// NYSE regular session: 09:30–16:00 ET, Mon–Fri.
export function usMarketStatus(): MarketStatus {
  const { dow, minutes } = partsIn("America/New_York");
  if (!isWeekday(dow)) return "closed";
  const open  = 9 * 60 + 30;
  const close = 16 * 60;
  return minutes >= open && minutes < close ? "open" : "closed";
}

// NSE regular session: 09:15–15:30 IST, Mon–Fri.
export function inMarketStatus(): MarketStatus {
  const { dow, minutes } = partsIn("Asia/Kolkata");
  if (!isWeekday(dow)) return "closed";
  const open  = 9 * 60 + 15;
  const close = 15 * 60 + 30;
  return minutes >= open && minutes < close ? "open" : "closed";
}

// Crypto venues like Hyperliquid run 24/7.
export function hyperliquidStatus(): MarketStatus { return "open"; }
