// Maps each 15-minute slot of "today" (Europe/Lisbon) to its display tariff
// period, so the Cartesian profile chart colors the day consistently. See CONTEXT.md — "Tariff periods" and
// "Aggregated curve" (slot 0 is local midnight, matching computeDailyProfile).

import { SLOTS_PER_DAY } from "$lib/consumption/profile";
import { resolveRegulatedPeriod } from "$lib/tariff/classify";
import { toDisplayPeriod } from "$lib/tariff/collapse";
import type { Cycle, DisplayPeriod } from "$lib/tariff/periods";

const LISBON = "Europe/Lisbon";

const lisbonDateFormatter = new Intl.DateTimeFormat("en-CA", {
  // "en-CA" formats dates year-first ("2026-09-02"), which slotInstant
  // splits into year / month / day numbers.
  timeZone: LISBON,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const lisbonOffsetFormatter = new Intl.DateTimeFormat("en-US", {
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

/** Offset of Europe/Lisbon at an instant, in minutes (west positive). */
function lisbonOffsetMinutes(at: Date): number {
  const parts = lisbonOffsetFormatter.formatToParts(at);
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

/** Instant at Lisbon wall-clock `slot` of `at`'s date (for tariff classification). */
function slotInstant(slot: number, at: Date): Date {
  const [year, month, day] = lisbonDateFormatter.format(at).split("-").map(Number);
  const minutes = slot * 15;
  const naive = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  // instant = naive - offset(instant); iterate twice for DST transition days.
  let instant = naive - lisbonOffsetMinutes(new Date(naive)) * 60_000;
  instant = naive - lisbonOffsetMinutes(new Date(instant)) * 60_000;
  return new Date(instant);
}

/**
 * Display period of each of today's 96 slots, colored by the season currently
 * in force so the graphs match "today's" tariff reality.
 */
export function computeSlotPeriods(
  cycle: Cycle = "semanal",
  at = new Date(),
): readonly DisplayPeriod[] {
  return Array.from({ length: SLOTS_PER_DAY }, (_, slot) =>
    toDisplayPeriod(resolveRegulatedPeriod(slotInstant(slot, at), cycle)),
  );
}
