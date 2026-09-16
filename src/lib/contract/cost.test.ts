// Tests for the cost calculator: energy per Reading (simples / bi / tri on
// the same fixture readings), power pro-rated across a contract switch
// mid-range, the coverage honesty layer, and the typed error paths. See
// docs/contract-invoice-plan.md — "Cost calculator".

import { Effect } from "effect";
import { expect, describe, it } from "vite-plus/test";
import { computeCost } from "./cost";
import type { Contract, CostRange, CostReading } from "./types";

/** UTC instants; February 2026 is WET (+00:00), so ts == Lisbon wall clock. */
const readings: ReadonlyArray<CostReading> = [
  { ts: "2026-02-04T03:00:00Z", valueWh: 1000, status: "real" }, // super vazio → vazio
  { ts: "2026-02-04T10:00:00Z", valueWh: 2000, status: "real" }, // ponta
  { ts: "2026-02-05T03:00:00Z", valueWh: 1000, status: "estimated" }, // super vazio → vazio
];

const biHorario: Contract = {
  id: "bi",
  cpe: "CPE1",
  option: "bi-horario",
  countingCycle: "semanal",
  contractedPowerKva: 4.6,
  powerPricePerDay: 5000, // 0.5 €/day/kVA
  validFrom: "2026-01-04",
  validTo: null,
  pricing: {
    kind: "fixed",
    pricesPerBilledPeriod: {
      unico: 2000,
      vazio: 1000, // 0.10 €/kWh
      "fora de vazio": 2000, // 0.20 €/kWh
      cheias: 2000,
      ponta: 2000,
    },
  },
};

// 2026-02-04 → 2026-03-04: 28 days, all WET.
const range: CostRange = { start: "2026-02-04T00:00:00Z", end: "2026-03-04T00:00:00Z" };

const run = (effect: ReturnType<typeof computeCost>) => Effect.runPromise(effect);

describe("energy term", () => {
  it("prices each reading by its billed period (bi-horário, ciclo semanal)", async () => {
    const cost = await run(computeCost(readings, [biHorario], range));
    // vazio: (1000 + 1000) Wh × 1000 (10⁻⁴ €/kWh) = 0.2 €
    // fora de vazio: 2000 Wh × 2000 = 0.4 €
    expect(cost.energy.perBilledPeriod).toEqual([
      { billedPeriod: "vazio", kwh: 2, eur: 0.2 },
      { billedPeriod: "fora de vazio", kwh: 2, eur: 0.4 },
    ]);
    expect(cost.energy.totalEur).toBe(0.6);
    expect(cost.tariffVersionIds).toEqual(["diretiva-1-2026"]);
  });

  it("simples bills everything as único, skipping regulated resolution", async () => {
    const simples: Contract = {
      ...biHorario,
      id: "simples",
      option: "simples",
      countingCycle: null,
      pricing: {
        kind: "fixed",
        pricesPerBilledPeriod: {
          unico: 1500,
          vazio: 0,
          "fora de vazio": 0,
          cheias: 0,
          ponta: 0,
        },
      },
    };
    const cost = await run(computeCost(readings, [simples], range));
    // (1000 + 2000 + 1000) Wh × 1500 (10⁻⁴ €/kWh) = 4000 Wh × 0.15 €/kWh = 0.6 €
    expect(cost.energy.perBilledPeriod).toEqual([{ billedPeriod: "unico", kwh: 4, eur: 0.6 }]);
    expect(cost.energy.totalEur).toBe(0.6);
    // No regulated resolution → no tariff versions used.
    expect(cost.tariffVersionIds).toEqual([]);
  });

  it("tri-horário separates cheias and ponta on the same readings", async () => {
    const tri: Contract = {
      ...biHorario,
      id: "tri",
      option: "tri-horario",
      pricing: {
        kind: "fixed",
        pricesPerBilledPeriod: {
          unico: 0,
          vazio: 1000,
          "fora de vazio": 0,
          cheias: 3000,
          ponta: 4000,
        },
      },
    };
    const cost = await run(computeCost(readings, [tri], range));
    // Feb 4 10:00 is ponta (semanal winter), the 03:00s are super vazio.
    expect(cost.energy.perBilledPeriod).toEqual([
      { billedPeriod: "vazio", kwh: 2, eur: 0.2 },
      { billedPeriod: "ponta", kwh: 2, eur: 0.8 },
    ]);
  });

  it("rejects indexed pricing (reserved for phase 4)", async () => {
    const indexed: Contract = {
      ...biHorario,
      id: "idx",
      pricing: { kind: "indexed", formula: { _reserved: "phase-4-omie-plan" } },
    };
    const error = await Effect.runPromise(Effect.flip(computeCost(readings, [indexed], range)));
    expect(error._tag).toBe("IndexedPricingNotSupported");
    if (error._tag === "IndexedPricingNotSupported") expect(error.contractId).toBe("idx");
  });
});

describe("power term", () => {
  it("pro-rates by active days: price × kVA × days", async () => {
    const cost = await run(computeCost(readings, [biHorario], range));
    // 0.5 €/day/kVA × 4.6 kVA × 28 days = 64.4 €
    expect(cost.power.activeDaysPerContract).toEqual([{ contractId: "bi", days: 28, eur: 64.4 }]);
    expect(cost.power.totalEur).toBe(64.4);
    expect(cost.totalEur).toBe(65);
  });

  it("splits days and readings across a contract switch mid-range", async () => {
    // Contract A in force Jan 1–20, B from Jan 21; range Jan 1 → Feb 1.
    const contractA: Contract = {
      id: "a",
      cpe: "CPE1",
      option: "simples",
      countingCycle: null,
      contractedPowerKva: 3.45,
      powerPricePerDay: 4000, // 0.4 €/day/kVA
      validFrom: "2026-01-01",
      validTo: "2026-01-20",
      pricing: {
        kind: "fixed",
        pricesPerBilledPeriod: { unico: 1500, vazio: 0, "fora de vazio": 0, cheias: 0, ponta: 0 },
      },
    };
    const contractB: Contract = {
      ...contractA,
      id: "b",
      validFrom: "2026-01-21",
      validTo: null,
      pricing: {
        kind: "fixed",
        pricesPerBilledPeriod: { unico: 2500, vazio: 0, "fora de vazio": 0, cheias: 0, ponta: 0 },
      },
    };
    const switchRange: CostRange = { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" };
    const switchReadings: ReadonlyArray<CostReading> = [
      { ts: "2026-01-20T12:00:00Z", valueWh: 1000, status: "real" }, // priced by A
      { ts: "2026-01-21T12:00:00Z", valueWh: 1000, status: "real" }, // priced by B
    ];

    const cost = await run(computeCost(switchReadings, [contractA, contractB], switchRange));

    // No reading is ever priced by a contract not in force at that moment.
    expect(cost.energy.perBilledPeriod).toEqual([
      { billedPeriod: "unico", kwh: 2, eur: 0.4 }, // 0.15 (A) + 0.25 (B)
    ]);
    // A: Jan 1–20 = 20 days → 0.4 × 3.45 × 20 = 27.6 €; B: Jan 21–31 = 11 days → 15.18 €.
    expect(cost.power.activeDaysPerContract).toEqual([
      { contractId: "a", days: 20, eur: 27.6 },
      { contractId: "b", days: 11, eur: 15.18 },
    ]);
    expect(cost.power.totalEur).toBeCloseTo(42.78, 10);
  });
});

describe("coverage (the honesty layer)", () => {
  it("reports slots with data vs expected up to the data horizon, and estimated readings", async () => {
    const cost = await run(computeCost(readings, [biHorario], range));
    // Latest reading Feb 5 03:00Z → horizon 03:15Z; 27.25 h from Feb 4 00:00Z = 109 slots.
    expect(cost.coverage).toEqual({ slotsWithData: 3, slotsExpected: 109, estimatedReadings: 1 });
  });

  it("estimated readings are included in the totals, not extrapolated", async () => {
    const realOnly = readings.filter((r) => r.status === "real");
    const withEstimated = await run(computeCost(readings, [biHorario], range));
    const without = await run(computeCost(realOnly, [biHorario], range));
    expect(withEstimated.energy.totalEur).toBe(0.6); // includes the estimated reading
    expect(without.energy.totalEur).toBe(0.5);
    expect(without.coverage.estimatedReadings).toBe(0);
  });

  it("a range with no readings reports zero coverage", async () => {
    const cost = await run(computeCost([], [biHorario], range));
    expect(cost.coverage).toEqual({ slotsWithData: 0, slotsExpected: 0, estimatedReadings: 0 });
    expect(cost.totalEur).toBe(64.4); // power still accrues by the day
  });
});

describe("error paths", () => {
  it("fails when no contract is in force at a reading or range day", async () => {
    const futureOnly: Contract = { ...biHorario, validFrom: "2026-02-06" };
    const error = await Effect.runPromise(Effect.flip(computeCost(readings, [futureOnly], range)));
    expect(error._tag).toBe("NoContractInForce");
  });

  it("fails when two contracts cover the same day", async () => {
    const overlapping: Contract = { ...biHorario, id: "other", validFrom: "2026-02-01" };
    const error = await Effect.runPromise(
      Effect.flip(computeCost(readings, [biHorario, overlapping], range)),
    );
    expect(error._tag).toBe("OverlappingContracts");
    if (error._tag === "OverlappingContracts") expect(error.contractIds).toEqual(["bi", "other"]);
  });

  it("ignores readings outside the range", async () => {
    const outside: CostReading = { ts: "2026-03-05T12:00:00Z", valueWh: 999_999, status: "real" };
    const cost = await run(computeCost([...readings, outside], [biHorario], range));
    expect(cost.coverage.slotsWithData).toBe(3);
    expect(cost.energy.totalEur).toBe(0.6);
  });
});
