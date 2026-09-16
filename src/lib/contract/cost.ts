// Invoice cost calculator (docs/contract-invoice-plan.md): pure module, no DB.
// Every 15-min Reading is priced independently by the contract in force at its
// own timestamp; totals are sums. A contract switch mid-period splits
// naturally: no reading is ever priced by a contract that was not in force at
// that moment, and the power term is pro-rated by active days per contract.
// Tax (IVA) is out of scope — totals are pre-tax so it can layer on later.

import { Data, Effect } from "effect";
import { resolveTariffVersion } from "$lib/tariff/calendar";
import { resolveRegulatedPeriod } from "$lib/tariff/classify";
import { toBilledPeriod } from "$lib/tariff/collapse";
import type { BilledPeriod } from "$lib/tariff/periods";
import type {
  BilledPeriodEnergy,
  Contract,
  ContractPowerDays,
  CostReading,
  InvoiceCost,
  InvoicePeriodRange,
  LisbonDate,
} from "./types";
import { lisbonDateOf, lisbonMidnightInstant } from "./invoice-period";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class NoContractInForceError extends Data.TaggedError("NoContractInForce")<{
  readonly at: string;
}> {}

export class OverlappingContractsError extends Data.TaggedError("OverlappingContracts")<{
  readonly date: LisbonDate;
  readonly contractIds: ReadonlyArray<string>;
}> {}

/** Reserved variant — indexed pricing lands with the phase 4 OMIE plan. */
export class IndexedPricingNotSupportedError extends Data.TaggedError(
  "IndexedPricingNotSupported",
)<{
  readonly contractId: string;
}> {}

export type InvoiceCostError =
  | NoContractInForceError
  | OverlappingContractsError
  | IndexedPricingNotSupportedError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const BILLED_PERIOD_ORDER: ReadonlyArray<BilledPeriod> = [
  "unico",
  "vazio",
  "fora de vazio",
  "cheias",
  "ponta",
];

/** One day later (Lisbon calendar arithmetic; month/year rollovers included). */
function nextLisbonDate(date: LisbonDate): LisbonDate {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function accumulate(map: Map<BilledPeriod, number>, key: BilledPeriod, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

/** Kill presentation float drift (kVA is fractional); keep 10 decimals of €, far beyond cent precision. */
function roundMoney(eur: number): number {
  return Math.round(eur * 1e10) / 1e10;
}

/**
 * Memoized lookup: the contracts whose validity interval (Lisbon dates,
 * validTo inclusive; null = open-ended) covers a date.
 */
function contractLookup(
  contracts: ReadonlyArray<Contract>,
): (date: LisbonDate) => ReadonlyArray<Contract> {
  const cache = new Map<LisbonDate, ReadonlyArray<Contract>>();
  return (date) => {
    const cached = cache.get(date);
    if (cached) return cached;
    const covering = contracts.filter(
      (contract) =>
        contract.validFrom <= date && (contract.validTo === null || date <= contract.validTo),
    );
    cache.set(date, covering);
    return covering;
  };
}

function requireContract(
  lookup: (date: LisbonDate) => ReadonlyArray<Contract>,
  date: LisbonDate,
): Effect.Effect<Contract, InvoiceCostError> {
  const covering = lookup(date);
  if (covering.length === 0) return Effect.fail(new NoContractInForceError({ at: date }));
  if (covering.length > 1) {
    return Effect.fail(
      new OverlappingContractsError({ date, contractIds: covering.map((c) => c.id) }),
    );
  }
  return Effect.succeed(covering[0]);
}

/**
 * Billed period of a reading (plan's layer 1 + 2). Simples skips regulated
 * resolution entirely; other options resolve through the tariff calendar,
 * collecting the versions used for invoice-discrepancy debugging (ADR 0004).
 */
function resolveBilledPeriod(
  contract: Contract,
  reading: CostReading,
  versionIds: Set<string>,
): BilledPeriod {
  if (contract.option === "simples") return "unico";
  const cycle = contract.countingCycle;
  if (cycle === null) {
    throw new Error(`Contract ${contract.id} is ${contract.option} but has no counting cycle`);
  }
  const at = new Date(reading.ts);
  const regulated = resolveRegulatedPeriod(at, cycle);
  versionIds.add(resolveTariffVersion(at).id);
  return toBilledPeriod(regulated, contract.option);
}

// ---------------------------------------------------------------------------
// Calculator
// ---------------------------------------------------------------------------

/**
 * Pre-tax cost of one invoice period.
 *
 * Energy — per Reading: contract in force at its timestamp (Lisbon date),
 * regulated period → billed period, then `valueWh / 1000 × price`. Prices are
 * integers in 10⁻⁴ €/kWh, so `valueWh × price` accumulates exactly in 10⁻⁷ €.
 * Power — `price × kVA × active Lisbon days` per contract, split at validity
 * boundaries.
 *
 * The price step is the extension point for indexed pricing (phase 4): plug
 * the indexation formula in where `pricesPerBilledPeriod` is read today.
 */
export const computeInvoiceCost = (
  readings: ReadonlyArray<CostReading>,
  contracts: ReadonlyArray<Contract>,
  period: InvoicePeriodRange,
): Effect.Effect<InvoiceCost, InvoiceCostError> =>
  Effect.gen(function* () {
    const startMs = Date.parse(period.start);
    const endMs = Date.parse(period.end);
    const lookup = contractLookup(contracts);

    // -- Power term: one active entry per Lisbon day of the period ----------
    const daysPerContract = new Map<string, { contract: Contract; days: number }>();
    for (
      let date = lisbonDateOf(new Date(startMs));
      lisbonMidnightInstant(date) < endMs;
      date = nextLisbonDate(date)
    ) {
      const contract = yield* requireContract(lookup, date);
      const entry = daysPerContract.get(contract.id) ?? { contract, days: 0 };
      entry.days += 1;
      daysPerContract.set(contract.id, entry);
    }

    const activeDaysPerContract: ContractPowerDays[] = [...daysPerContract.values()]
      .map(({ contract, days }) => ({
        contractId: contract.id,
        days,
        // price (10⁻⁴ €/day/kVA) × kVA × days = 10⁻⁴ €.
        eur: roundMoney((contract.powerPricePerDay * contract.contractedPowerKva * days) / 10_000),
      }))
      .filter((entry) => entry.days > 0);
    const powerTotalEur = roundMoney(
      activeDaysPerContract.reduce((sum, entry) => sum + entry.eur, 0),
    );

    // -- Energy term: per Reading -------------------------------------------
    const inRange = readings
      .filter((reading) => {
        const ts = Date.parse(reading.ts);
        return ts >= startMs && ts < endMs;
      })
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

    const whByPeriod = new Map<BilledPeriod, number>();
    // valueWh × price (10⁻⁴ €/kWh) = 10⁻⁷ €; integer Wh and prices keep the
    // accumulation exact — no float drift.
    const microCostByPeriod = new Map<BilledPeriod, number>();
    const versionIds = new Set<string>();

    for (const reading of inRange) {
      const contract = yield* requireContract(lookup, lisbonDateOf(new Date(reading.ts)));
      if (contract.pricing.kind === "indexed") {
        return yield* Effect.fail(new IndexedPricingNotSupportedError({ contractId: contract.id }));
      }
      const billed = resolveBilledPeriod(contract, reading, versionIds);
      const price = contract.pricing.pricesPerBilledPeriod[billed];
      accumulate(whByPeriod, billed, reading.valueWh);
      accumulate(microCostByPeriod, billed, reading.valueWh * price);
    }

    const perBilledPeriod: BilledPeriodEnergy[] = BILLED_PERIOD_ORDER.filter((billed) =>
      whByPeriod.has(billed),
    ).map((billed) => ({
      billedPeriod: billed,
      kwh: (whByPeriod.get(billed) ?? 0) / 1000,
      eur: (microCostByPeriod.get(billed) ?? 0) / 10_000_000,
    }));
    const energyTotalEur =
      [...microCostByPeriod.values()].reduce((sum, micro) => sum + micro, 0) / 10_000_000;

    // -- Coverage: the honesty layer ----------------------------------------
    // Expected slots run from the period start to the end of the latest
    // reading we hold (or the period end, when data covers it) — a running
    // period is never penalized for its projected future, but stale data
    // shows up as missing slots.
    const slotsWithData = inRange.length;
    const estimatedReadings = inRange.filter((reading) => reading.status !== "real").length;
    let slotsExpected = 0;
    if (inRange.length > 0) {
      const horizonMs = Date.parse(inRange[inRange.length - 1].ts) + FIFTEEN_MINUTES_MS;
      slotsExpected = Math.max(
        0,
        Math.round((Math.min(endMs, horizonMs) - startMs) / FIFTEEN_MINUTES_MS),
      );
    }

    return {
      periodStart: period.start,
      periodEnd: period.end,
      totalEur: roundMoney(energyTotalEur + powerTotalEur),
      energy: { totalEur: energyTotalEur, perBilledPeriod },
      power: { totalEur: powerTotalEur, activeDaysPerContract },
      coverage: { slotsWithData, slotsExpected, estimatedReadings },
      tariffVersionIds: [...versionIds].sort(),
    } satisfies InvoiceCost;
  });
