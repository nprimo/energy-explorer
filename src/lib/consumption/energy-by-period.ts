// Total energy per tariff period: classifies each reading's instant (ADR 0003
// hypothesis — timestamps mark the slot; classification uses the reading's own
// timestamp, matching the invoice calculator in src/lib/contract/cost.ts) and
// sums Wh. Conceptually Europe/Lisbon local time; the resolver handles season
// and DST internally. See CONTEXT.md — "Tariff period" and "Regulated period".

import { resolveRegulatedPeriod } from "$lib/tariff/classify";
import { toDisplayPeriod } from "$lib/tariff/collapse";
import type { Cycle, DisplayPeriod, RegulatedPeriod } from "$lib/tariff/periods";
import type { ProfileReading } from "./profile";

export type PeriodEnergy = {
  readonly period: RegulatedPeriod;
  readonly wh: number;
};

export type DisplayPeriodEnergy = {
  readonly period: DisplayPeriod;
  readonly wh: number;
};

export type EnergyByPeriod = {
  /** Sum of every valid reading, independently of classification. */
  readonly totalWh: number;
  /** The four regulated periods, ordered ponta → cheias → vazio normal → super vazio. */
  readonly regulated: ReadonlyArray<PeriodEnergy>;
  /** Display collapse (vazio normal + super vazio = baixa), ordered ponta → cheia → baixa. */
  readonly display: ReadonlyArray<DisplayPeriodEnergy>;
};

const REGULATED_ORDER: ReadonlyArray<RegulatedPeriod> = [
  "ponta",
  "cheias",
  "vazio normal",
  "super vazio",
];
const DISPLAY_ORDER: ReadonlyArray<DisplayPeriod> = ["ponta", "cheia", "baixa"];

/**
 * Sum Wh per regulated and display tariff period over a set of readings.
 * Readings with an unparseable timestamp are skipped; `totalWh` stays
 * consistent with the per-period sums.
 */
export function computeEnergyByPeriod(
  readings: readonly ProfileReading[],
  cycle: Cycle = "semanal",
): EnergyByPeriod {
  const regulated = new Map<RegulatedPeriod, number>();
  const display = new Map<DisplayPeriod, number>();
  let totalWh = 0;

  for (const reading of readings) {
    const at = new Date(reading.timestamp);
    if (Number.isNaN(at.getTime())) continue;
    totalWh += reading.valueWh;
    const period = resolveRegulatedPeriod(at, cycle);
    regulated.set(period, (regulated.get(period) ?? 0) + reading.valueWh);
    const shown = toDisplayPeriod(period);
    display.set(shown, (display.get(shown) ?? 0) + reading.valueWh);
  }

  return {
    totalWh,
    regulated: REGULATED_ORDER.filter((period) => regulated.has(period)).map((period) => ({
      period,
      wh: regulated.get(period) ?? 0,
    })),
    display: DISPLAY_ORDER.filter((period) => display.has(period)).map((period) => ({
      period,
      wh: display.get(period) ?? 0,
    })),
  };
}
