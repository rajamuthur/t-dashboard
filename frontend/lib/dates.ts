/**
 * Date/time formatting helpers shared by the trades module.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format ISO date 'YYYY-MM-DD' as 'DD MMM YYYY' (e.g. "22 Jun 2026"). */
export function fmtIsoDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const idx = parseInt(mo, 10) - 1;
  return `${d} ${MONTHS[idx] ?? mo} ${y}`;
}

/** Format ISO datetime as 'DD MMM YYYY, HH:MM' in the browser's local timezone. */
export function fmtIsoDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getDate()).padStart(2, "0");
  const mon = MONTHS[d.getMonth()] ?? "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon} ${d.getFullYear()}, ${hh}:${mm}`;
}

/** Convert a browser-local datetime-local string ("YYYY-MM-DDTHH:mm") to UTC ISO. */
export function localDatetimeToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** ISO date/datetime → "YYYY-MM-DDTHH:mm" suitable for an <input type="datetime-local">. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
