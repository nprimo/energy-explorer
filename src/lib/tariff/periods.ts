// Tariff domain types for ERSE's "períodos horários" (Portugal continental).
// See CONTEXT.md — "Tariff domain" — and docs/periodos-horarios-source.md.

/** ERSE's four regulated periods (the directive's own Portuguese names). */
export type RegulatedPeriod = "ponta" | "cheias" | "vazio normal" | "super vazio";

/**
 * The 3 display periods shown in the graphs, independent of the contract
 * option: baixa = vazio normal + super vazio. Simples, bi-horário and
 * tri-horário contracts all use the same 3-way display collapse.
 */
export type DisplayPeriod = "baixa" | "cheia" | "ponta";

/** What the contract's option bills. Future cost work; never used for coloring. */
export type BilledPeriod = "vazio" | "fora de vazio" | "cheias" | "ponta" | "unico";

/** Contract option. Only needed by the billing collapse, never for display. */
export type TariffOption = "simples" | "bi-horario" | "tri-horario";

/** Counting cycle (ciclo de contagem). A simples contract has no cycle. */
export type Cycle = "diario" | "semanal";

/** Legal-time half of the year (DL n.º 17/96). See CONTEXT.md — "Season". */
export type Season = "inverno" | "verao";

/** Id of an effective-dated bracket set, e.g. "diretiva-1-2026". */
export type TariffVersionId = string;
