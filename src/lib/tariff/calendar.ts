// Effective-dated tariff bracket data for BTN (Portugal continental), checked in
// per ADR 0004 — no runtime fetching. Source of truth: ERSE annual tariff
// directives ("Períodos horários em Portugal continental"); see
// docs/periodos-horarios-source.md. Renewal checklist lives there too.
//
// Brackets are stored over the directive's four regulated periods; the collapse
// into billed/display periods is code (see collapse.ts), not data.

import type { Cycle, RegulatedPeriod, Season, TariffVersionId } from "./periods";

/** Day kinds of the ciclo semanal tables (dias úteis, sábados, domingos). */
export type SemanalDayKind = "util" | "sabado" | "domingo";

/**
 * One bracket: [start, end) in minutes since local midnight (Europe/Lisbon).
 * A bracket that runs past midnight has end > 1440 (e.g. 22:00–02:00 is
 * { start: 1320, end: 1560 }).
 */
export type Bracket = {
  readonly period: RegulatedPeriod;
  readonly start: number;
  readonly end: number;
};

type DayTable = readonly Bracket[];

export type TariffVersion = {
  readonly id: TariffVersionId;
  readonly sourceUrl: string;
  /** First day (Lisbon calendar date) the brackets apply, inclusive. */
  readonly validFrom: string;
  /** Last day they apply, inclusive; null = still in force. */
  readonly validTo: string | null;
  /** Ciclo diário: the same table every day, split by legal-time season. */
  readonly diario: Readonly<Record<Season, DayTable>>;
  /** Ciclo semanal: dias úteis / sábados / domingos × season. */
  readonly semanal: Readonly<Record<Season, Readonly<Record<SemanalDayKind, DayTable>>>>;
};

// Diretiva n.º 1/2026 (DR, 7 January 2026), in force for 2026 — the tables are
// identical to Diretiva n.º 12/2024 (2025 tariffs). See
// docs/periodos-horarios-source.md for the legal chain and the next change
// (Diretiva n.º 3/2026, effective 2027).
//
// National holidays: treated as their weekday (the BTN rule is still unverified
// against the directive text — ADR 0004). DST fall-back: each occurrence is
// classified by its own wall-clock label (ADR 0004 working rule).
const DIRETIVA_1_2026: TariffVersion = {
  id: "diretiva-1-2026",
  sourceUrl: "https://files.diariodarepublica.pt/2s/2026/01/004000000/0018600288.pdf",
  validFrom: "2026-01-01",
  validTo: null,
  diario: {
    inverno: [
      { period: "vazio normal", start: 360, end: 480 },
      { period: "vazio normal", start: 1320, end: 1560 },
      { period: "super vazio", start: 120, end: 360 },
      { period: "cheias", start: 480, end: 540 },
      { period: "ponta", start: 540, end: 630 },
      { period: "cheias", start: 630, end: 1080 },
      { period: "ponta", start: 1080, end: 1230 },
      { period: "cheias", start: 1230, end: 1320 },
    ],
    verao: [
      { period: "vazio normal", start: 360, end: 480 },
      { period: "vazio normal", start: 1320, end: 1560 },
      { period: "super vazio", start: 120, end: 360 },
      { period: "cheias", start: 480, end: 630 },
      { period: "ponta", start: 630, end: 780 },
      { period: "cheias", start: 780, end: 1170 },
      { period: "ponta", start: 1170, end: 1260 },
      { period: "cheias", start: 1260, end: 1320 },
    ],
  },
  semanal: {
    inverno: {
      util: [
        { period: "vazio normal", start: 0, end: 120 },
        { period: "vazio normal", start: 360, end: 420 },
        { period: "super vazio", start: 120, end: 360 },
        { period: "cheias", start: 420, end: 570 },
        { period: "ponta", start: 570, end: 720 },
        { period: "cheias", start: 720, end: 1110 },
        { period: "ponta", start: 1110, end: 1260 },
        { period: "cheias", start: 1260, end: 1440 },
      ],
      sabado: [
        { period: "vazio normal", start: 0, end: 120 },
        { period: "vazio normal", start: 360, end: 570 },
        { period: "vazio normal", start: 780, end: 1110 },
        { period: "vazio normal", start: 1320, end: 1440 },
        { period: "super vazio", start: 120, end: 360 },
        { period: "cheias", start: 570, end: 780 },
        { period: "cheias", start: 1110, end: 1320 },
      ],
      domingo: [
        { period: "vazio normal", start: 0, end: 120 },
        { period: "vazio normal", start: 360, end: 1440 },
        { period: "super vazio", start: 120, end: 360 },
      ],
    },
    verao: {
      util: [
        { period: "vazio normal", start: 0, end: 120 },
        { period: "vazio normal", start: 360, end: 420 },
        { period: "super vazio", start: 120, end: 360 },
        { period: "cheias", start: 420, end: 555 },
        { period: "ponta", start: 555, end: 735 },
        { period: "cheias", start: 735, end: 1440 },
      ],
      sabado: [
        { period: "vazio normal", start: 0, end: 120 },
        { period: "vazio normal", start: 360, end: 540 },
        { period: "vazio normal", start: 840, end: 1200 },
        { period: "vazio normal", start: 1320, end: 1440 },
        { period: "super vazio", start: 120, end: 360 },
        { period: "cheias", start: 540, end: 840 },
        { period: "cheias", start: 1200, end: 1320 },
      ],
      domingo: [
        { period: "vazio normal", start: 0, end: 120 },
        { period: "vazio normal", start: 360, end: 1440 },
        { period: "super vazio", start: 120, end: 360 },
      ],
    },
  },
};

export const TARIFF_VERSIONS: readonly TariffVersion[] = [DIRETIVA_1_2026];

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Lisbon",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Lisbon calendar date of an instant, as "YYYY-MM-DD". */
function lisbonIsoDate(at: Date): string {
  return dateFormatter.format(at);
}

/**
 * Pick the bracket set for an instant. An explicit versionId bypasses the
 * validity window (per-meter overrides for the 2027 rollout, ADR 0004).
 */
export function resolveTariffVersion(at: Date, versionId?: TariffVersionId): TariffVersion {
  if (versionId !== undefined) {
    const version = TARIFF_VERSIONS.find((v) => v.id === versionId);
    if (!version) {
      throw new Error(`Unknown tariff version: ${versionId}`);
    }
    return version;
  }

  const day = lisbonIsoDate(at);
  const version = TARIFF_VERSIONS.find(
    (v) => v.validFrom <= day && (v.validTo === null || day <= v.validTo),
  );
  if (!version) {
    const oldest = TARIFF_VERSIONS.reduce(
      (min, v) => (v.validFrom < min ? v.validFrom : min),
      TARIFF_VERSIONS[0].validFrom,
    );
    throw new Error(`No tariff version covers ${day} (checked-in versions start at ${oldest})`);
  }
  return version;
}

/** The day table a classification needs: cycle → season → day kind. */
export function tableFor(
  version: TariffVersion,
  cycle: Cycle,
  season: Season,
  dayKind: SemanalDayKind,
): DayTable {
  if (cycle === "diario") return version.diario[season];
  return version.semanal[season][dayKind];
}
