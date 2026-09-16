// Contract domain types for cost estimation. See docs/contract-invoice-plan.md.
// Mirrors the shape of src/lib/tariff/ — pure types, no DB, no time logic.

import type { BilledPeriod, Cycle, TariffOption } from "$lib/tariff/periods";

/** Lisbon calendar date ("YYYY-MM-DD"). Every contract date is a local date. */
export type LisbonDate = string;

/** Half-open [start, end) analysis range, UTC ISO-8601. */
export type CostRange = { readonly start: string; readonly end: string };

/**
 * How an indexed contract derives its energy price. Reserved term — the shape
 * is deliberately unspecified until the phase 4 OMIE plan (see the plan's
 * "Indexation formula"). The calculator rejects `kind: "indexed"` until then.
 */
export type IndexationFormula = { readonly _reserved: "phase-4-omie-plan" };

/**
 * Energy prices as integers in 10⁻⁴ €/kWh (ERSE publishes 4 decimals, e.g.
 * `0,1548` → 1548), so retail prices store exactly with no float drift.
 * Every `BilledPeriod` key must be present; the calculator reads only the
 * periods the contract's option can bill.
 */
export type FixedPricing = {
  readonly kind: "fixed";
  readonly pricesPerBilledPeriod: Record<BilledPeriod, number>;
};

/** Reserved variant — rejected by the calculator until phase 4. */
export type IndexedPricing = {
  readonly kind: "indexed";
  readonly formula: IndexationFormula;
};

export type ContractPricing = FixedPricing | IndexedPricing;

/**
 * An effective-dated electricity contract. A switch is a new row whose
 * `validFrom` is the switch date; history is kept so past costs can be
 * recomputed with the contract actually in force.
 */
export type Contract = {
  readonly id: string;
  readonly cpe: string;
  readonly option: TariffOption;
  /** Counting cycle; null when simples (simples skips regulated-period resolution). */
  readonly countingCycle: Cycle | null;
  readonly contractedPowerKva: number;
  /** €/day per kVA, integer 10⁻⁴ (covers the network-access power charge). */
  readonly powerPricePerDay: number;
  readonly validFrom: LisbonDate;
  /** Last day in force, inclusive; null = still in force. */
  readonly validTo: LisbonDate | null;
  readonly pricing: ContractPricing;
};

/** One 15-min reading as the calculator consumes it (register A+ only). */
export type CostReading = {
  /** UTC ISO-8601, mirrors the readings table. */
  readonly ts: string;
  readonly valueWh: number;
  /** "real" / "estimated" / ... — feeds the coverage layer. */
  readonly status: string;
};

/** Energy subtotal for one billed period. */
export type BilledPeriodEnergy = {
  readonly billedPeriod: BilledPeriod;
  readonly kwh: number;
  readonly eur: number;
};

/** Power subtotal for one contract, pro-rated by its active days in the range. */
export type ContractPowerDays = {
  readonly contractId: string;
  readonly days: number;
  readonly eur: number;
};

/** The honesty layer (ADR 0001 spirit: never extrapolate). */
export type CostCoverage = {
  /** 15-min slots inside the range that have at least one reading. */
  readonly slotsWithData: number;
  /**
   * Slots we should have data for: from the range start to the end of the
   * latest reading we hold (or the range end, if data covers it). Ranges that
   * extend past the data are never penalized for their missing future.
   */
  readonly slotsExpected: number;
  /** Readings included in the totals but flagged estimated by E-REDES. */
  readonly estimatedReadings: number;
};

/** Pre-tax cost over an analysis range. Tax (IVA) layers on later, outside the calculator. */
export type CostEstimate = {
  readonly rangeStart: string;
  readonly rangeEnd: string;
  readonly totalEur: number;
  readonly energy: {
    readonly totalEur: number;
    readonly perBilledPeriod: ReadonlyArray<BilledPeriodEnergy>;
  };
  readonly power: {
    readonly totalEur: number;
    readonly activeDaysPerContract: ReadonlyArray<ContractPowerDays>;
  };
  readonly coverage: CostCoverage;
  /** Tariff versions used while pricing — for cost-discrepancy debugging (ADR 0004). */
  readonly tariffVersionIds: ReadonlyArray<string>;
};
