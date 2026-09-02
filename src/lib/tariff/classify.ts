// Layer 1 classification (ADR 0004): instant + cycle → regulated period.
// Contract-free except for the cycle. Works in Europe/Lisbon wall clock;
// on DST fall-back days each occurrence is classified by its own wall-clock
// label (ADR 0004 working rule).

import { resolveTariffVersion, tableFor } from "./calendar";
import type { Cycle, RegulatedPeriod, Season, TariffVersionId } from "./periods";

const ZONE = "Europe/Lisbon";

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  hourCycle: "h23",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  timeZoneName: "longOffset",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * Hora legal de inverno/verão (DL n.º 17/96), read off the zone's UTC offset:
 * WET (+00:00) → inverno, WEST (+01:00) → verão. On DST fall-back days the two
 * occurrences of the repeated hour carry different offsets and classify
 * accordingly.
 */
function seasonAt(at: Date): Season {
  const name =
    offsetFormatter.formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  return /GMT(\+00:00)?$/.test(name) ? "inverno" : "verao";
}

/** Minutes since Lisbon local midnight (0–1439). */
function wallClockMinutes(at: Date): number {
  let hour = 0;
  let minute = 0;
  for (const part of partsFormatter.formatToParts(at)) {
    if (part.type === "hour") hour = Number(part.value);
    else if (part.type === "minute") minute = Number(part.value);
  }
  return (hour % 24) * 60 + minute;
}

/** Ciclo semanal day kind from the Lisbon weekday. Holidays are not handled. */
function semanalDayKind(at: Date): "util" | "sabado" | "domingo" {
  const weekday =
    partsFormatter.formatToParts(at).find((part) => part.type === "weekday")?.value ?? "";
  if (weekday === "Sat") return "sabado";
  if (weekday === "Sun") return "domingo";
  return "util";
}

/**
 * The regulated period in force at an instant for a counting cycle. Bracket
 * boundaries are start-inclusive / end-exclusive, so a slot starting exactly
 * at a boundary belongs to the period that begins there.
 */
export function resolveRegulatedPeriod(
  at: Date,
  cycle: Cycle,
  options?: { versionId?: TariffVersionId },
): RegulatedPeriod {
  const version = resolveTariffVersion(at, options?.versionId);
  const table = tableFor(version, cycle, seasonAt(at), semanalDayKind(at));
  const minutes = wallClockMinutes(at);

  for (const bracket of table) {
    if (bracket.end > 1440) {
      // Wraps past midnight (e.g. 22:00–02:00).
      const end = bracket.end - 1440;
      if (minutes >= bracket.start || minutes < end) return bracket.period;
    } else if (minutes >= bracket.start && minutes < bracket.end) {
      return bracket.period;
    }
  }

  throw new Error(
    `Tariff version ${version.id} (${cycle}) does not cover minute ${minutes} — table is incomplete`,
  );
}
