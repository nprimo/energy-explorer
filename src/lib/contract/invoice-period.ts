// Invoice-period arithmetic (docs/contract-invoice-plan.md): monthly periods
// derived from a contract's anchor date, in Europe/Lisbon local time,
// converted to true UTC for storage and querying (ADR 0002).
//
// Anchor rule (settled in the plan): the day-of-month is the anchor date's own
// day; when a month does not have it (anchors 29–31) the period starts on that
// month's last day, and the anchor's day is used again as soon as the month
// has it — no permanent drift (Stripe's billing-cycle-anchor rule). A contract
// whose validFrom precedes its next anchor occurrence bills a partial first
// period, like Stripe prorating from subscription start to the anchor.

import type { InvoicePeriodRange, LisbonDate } from "./types";

const LISBON = "Europe/Lisbon";

type Ymd = { readonly year: number; readonly month: number; readonly day: number };
type YearMonth = { readonly year: number; readonly month: number };

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
export function lisbonDateOf(at: Date): LisbonDate {
  return lisbonDateFormatter.format(at);
}

function parseLisbonDate(date: LisbonDate): Ymd {
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

function formatYmd({ year, month, day }: Ymd): LisbonDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nextMonth({ year, month }: YearMonth): YearMonth {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** UTC ISO-8601 without milliseconds when they are zero (readings-table format). */
function isoUtc(ms: number): string {
  const iso = new Date(ms).toISOString();
  return ms % 1000 === 0 ? iso.replace(".000Z", "Z") : iso;
}

/**
 * The UTC instant (epoch ms) of local midnight at the start of `date` in
 * Europe/Lisbon. instant = naive − offset(instant); iterate twice so days at
 * a DST transition settle (ADR 0002).
 */
export function lisbonMidnightInstant(date: LisbonDate): number {
  const { year, month, day } = parseLisbonDate(date);
  const naive = Date.UTC(year, month - 1, day);
  let instant = naive - lisbonOffsetMinutes(new Date(naive)) * 60_000;
  instant = naive - lisbonOffsetMinutes(new Date(instant)) * 60_000;
  return instant;
}

/** UTC ISO-8601 of local midnight starting `date` in Europe/Lisbon. */
export function lisbonMidnightUtc(date: LisbonDate): string {
  return isoUtc(lisbonMidnightInstant(date));
}

/**
 * The anchor occurrence for a given month: the anchor's own day when the
 * cursor is still on the anchor's month (the cycle's first month), otherwise
 * the anchor day clamped down to the month's last day when the month is
 * shorter (29/30/31 clamping, e.g. anchor 31 → Feb 28).
 */
function occurrenceFor(cursor: YearMonth, anchor: Ymd): LisbonDate {
  const day =
    cursor.year === anchor.year && cursor.month === anchor.month
      ? anchor.day
      : Math.min(anchor.day, daysInMonth(cursor.year, cursor.month));
  return formatYmd({ ...cursor, day });
}

/**
 * The invoice period containing `at`: the latest period whose start is ≤ at.
 * Period starts are `validFrom` (possibly a partial first period) followed by
 * every anchor occurrence strictly after it; each period runs to the next
 * start. Half-open [start, end) in UTC ISO-8601; starts are 00:00 Lisbon.
 */
export function invoicePeriodAt(
  anchorDate: LisbonDate,
  validFrom: LisbonDate,
  at: Date,
): InvoicePeriodRange {
  const anchor = parseLisbonDate(anchorDate);
  const fromMs = lisbonMidnightInstant(validFrom);
  const atMs = at.getTime();
  if (atMs < fromMs) {
    throw new Error(
      `No invoice period contains ${at.toISOString()} — contract is only valid from ${validFrom}`,
    );
  }

  // Greatest anchor occurrence ≤ at, walking month by month from the anchor's
  // own month (occurrences do not exist before the cycle started).
  let lastOccurrenceMs: number | null = null;
  let cursor: YearMonth = { year: anchor.year, month: anchor.month };
  for (;;) {
    const occurrenceMs = lisbonMidnightInstant(occurrenceFor(cursor, anchor));
    if (occurrenceMs > atMs) break;
    lastOccurrenceMs = occurrenceMs;
    cursor = nextMonth(cursor);
  }

  // The governing start: the occurrence itself, or validFrom when it falls
  // mid-period (partial first period) — whichever is later.
  const startMs = lastOccurrenceMs === null ? fromMs : Math.max(fromMs, lastOccurrenceMs);

  // End: the next anchor occurrence strictly after the start (a projection
  // when the period is still running).
  let endMs: number | null = null;
  cursor = { year: anchor.year, month: anchor.month };
  for (;;) {
    const occurrenceMs = lisbonMidnightInstant(occurrenceFor(cursor, anchor));
    if (occurrenceMs > startMs) {
      endMs = occurrenceMs;
      break;
    }
    cursor = nextMonth(cursor);
  }

  return {
    start: isoUtc(startMs),
    end: isoUtc(endMs),
  };
}

/**
 * The current invoice period for a contract: the latest period whose start is
 * ≤ now. Its end is a projection, not a bill.
 */
export function currentInvoicePeriod(
  anchorDate: LisbonDate,
  validFrom: LisbonDate,
  now: Date = new Date(),
): InvoicePeriodRange {
  return invoicePeriodAt(anchorDate, validFrom, now);
}
