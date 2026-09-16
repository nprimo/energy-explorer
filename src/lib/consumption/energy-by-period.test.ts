// Tests for computeEnergyByPeriod: per-period Wh sums on fixtures classified
// against the ciclo semanal tables (winter weekdays ponta 09:30–12:00 and
// 18:30–21:00; super vazio 02:00–06:00 — see src/lib/tariff/tariff.test.ts).

import { expect, describe, it } from "vite-plus/test";
import { computeEnergyByPeriod } from "./energy-by-period";
import type { ProfileReading } from "./profile";

// February 2026 is WET (+00:00): Lisbon wall clock == UTC instant.
// Readings carry valueWh proportional to 1000 per period for easy sums.
const readings: ReadonlyArray<ProfileReading> = [
  { timestamp: "2026-02-04T10:00:00Z", valueWh: 100 }, // ponta (09:30–12:00)
  { timestamp: "2026-02-04T19:00:00Z", valueWh: 100 }, // ponta (18:30–21:00)
  { timestamp: "2026-02-04T08:00:00Z", valueWh: 300 }, // cheias
  { timestamp: "2026-02-04T22:30:00Z", valueWh: 300 }, // cheias (22:00–02:00)
  { timestamp: "2026-02-04T06:30:00Z", valueWh: 700 }, // vazio normal
  { timestamp: "2026-02-04T04:00:00Z", valueWh: 500 }, // super vazio
];

describe("computeEnergyByPeriod", () => {
  it("sums Wh per regulated period (ciclo semanal, winter weekday)", () => {
    const result = computeEnergyByPeriod(readings);
    expect(result.regulated).toEqual([
      { period: "ponta", wh: 200 },
      { period: "cheias", wh: 600 },
      { period: "vazio normal", wh: 700 },
      { period: "super vazio", wh: 500 },
    ]);
    expect(result.totalWh).toBe(2000);
  });

  it("collapses vazio normal + super vazio into baixa for display", () => {
    const result = computeEnergyByPeriod(readings);
    expect(result.display).toEqual([
      { period: "ponta", wh: 200 },
      { period: "cheia", wh: 600 },
      { period: "baixa", wh: 1200 },
    ]);
  });

  it("omits periods with no readings instead of reporting zero", () => {
    const nightOnly: ReadonlyArray<ProfileReading> = [
      { timestamp: "2026-02-04T04:00:00Z", valueWh: 500 },
    ];
    const result = computeEnergyByPeriod(nightOnly);
    expect(result.regulated).toEqual([{ period: "super vazio", wh: 500 }]);
    expect(result.display).toEqual([{ period: "baixa", wh: 500 }]);
  });

  it("classifies summer instants via their UTC offset (Lisbon 10:00 = 09:00Z)", () => {
    const summer: ReadonlyArray<ProfileReading> = [
      { timestamp: "2026-07-15T09:00:00Z", valueWh: 100 }, // Lisbon 10:00 → ponta
      { timestamp: "2026-07-15T05:30:00Z", valueWh: 400 }, // Lisbon 06:30 → vazio normal
    ];
    const result = computeEnergyByPeriod(summer);
    expect(result.regulated).toEqual([
      { period: "ponta", wh: 100 },
      { period: "vazio normal", wh: 400 },
    ]);
  });

  it("skips readings with unparseable timestamps", () => {
    const withBad: ReadonlyArray<ProfileReading> = [
      ...readings,
      { timestamp: "not-a-date", valueWh: 9999 },
    ];
    const result = computeEnergyByPeriod(withBad);
    expect(result.totalWh).toBe(2000);
  });

  it("supports ciclo diário on request", () => {
    // Lisbon 07:00 is cheias under ciclo semanal (cheias 07:00–09:30) but
    // vazio normal under ciclo diário (06:00–08:00).
    const early: ReadonlyArray<ProfileReading> = [
      { timestamp: "2026-02-04T07:00:00Z", valueWh: 100 },
    ];
    expect(computeEnergyByPeriod(early, "semanal").regulated).toEqual([
      { period: "cheias", wh: 100 },
    ]);
    expect(computeEnergyByPeriod(early, "diario").regulated).toEqual([
      { period: "vazio normal", wh: 100 },
    ]);
  });
});
