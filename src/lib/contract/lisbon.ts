// Lisbon local-time helpers for the cost calculator (ADR 0002: true UTC at
// the edges, Europe/Lisbon for calendar arithmetic). Extracted from the
// retired invoice-period module — the calendar-day boundaries the cost
// calculator needs (contract validity and active power days are Lisbon dates).

const LISBON = "Europe/Lisbon";

type Ymd = { readonly year: number; readonly month: number; readonly day: number };

const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: LISBON,
  timeZoneName: "longOffset",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// en-CA formats dates year-first ("2026-09-08").
const lisbonDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: LISBON,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Offset of Europe/Lisbon at an instant, in minutes (west positive). */
function lisbonOffsetMinutes(at: Date): number {
  const parts = offsetFormatter.formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return (asUtc - at.getTime()) / 60_000;
}

/** The Lisbon calendar date ("YYYY-MM-DD") an instant falls on. */
export function lisbonDateOf(at: Date): string {
  return lisbonDateFormatter.format(at);
}

function parseLisbonDate(date: string): Ymd {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid Lisbon date "${date}" — expected "YYYY-MM-DD"`);
  const [year, month, day] = match.slice(1).map(Number);
  const canonical = new Date(Date.UTC(year, month - 1, day));
  if (
    canonical.getUTCFullYear() !== year ||
    canonical.getUTCMonth() !== month - 1 ||
    canonical.getUTCDate() !== day
  ) {
    throw new Error(`Invalid Lisbon date "${date}"`);
  }
  return { year, month, day };
}

/**
 * The UTC instant (epoch ms) of local midnight at the start of `date` in
 * Europe/Lisbon. instant = naive − offset(instant); iterate twice so days at
 * a DST transition settle (ADR 0002).
 */
export function lisbonMidnightInstant(date: string): number {
  const { year, month, day } = parseLisbonDate(date);
  const naive = Date.UTC(year, month - 1, day);
  let instant = naive - lisbonOffsetMinutes(new Date(naive)) * 60_000;
  instant = naive - lisbonOffsetMinutes(new Date(instant)) * 60_000;
  return instant;
}
