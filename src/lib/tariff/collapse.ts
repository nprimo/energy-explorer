// Pure collapses of a regulated period (ADR 0004 layer 2 + display layer).
// No time logic, no table lookups — the only input is the regulated period
// returned by resolveRegulatedPeriod.

import type { BilledPeriod, DisplayPeriod, RegulatedPeriod, TariffOption } from "./periods";

/**
 * Display collapse used to color the graphs: baixa = vazio normal + super
 * vazio. Option-independent — simples, bi-horário and tri-horário contracts
 * all show the same 3 periods.
 */
export function toDisplayPeriod(period: RegulatedPeriod): DisplayPeriod {
  switch (period) {
    case "ponta":
      return "ponta";
    case "cheias":
      return "cheia";
    case "vazio normal":
    case "super vazio":
      return "baixa";
  }
}

/**
 * Billed collapse: simples → único (no cycle needed); bi-horário → vazio /
 * fora de vazio; tri-horário → vazio / cheias / ponta. For future cost
 * calculations, not for coloring.
 */
export function toBilledPeriod(period: RegulatedPeriod, option: TariffOption): BilledPeriod {
  if (option === "simples") return "unico";
  if (option === "bi-horario") {
    return period === "vazio normal" || period === "super vazio" ? "vazio" : "fora de vazio";
  }
  return period === "ponta" ? "ponta" : period === "cheias" ? "cheias" : "vazio";
}
