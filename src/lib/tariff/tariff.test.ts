// Tests for the tariff calendar module (ADR 0004): collapse rules, table
// invariants, classification for both cycles × both seasons, boundary
// semantics and DST fall-back behaviour.

import { expect, describe, it } from "vite-plus/test";
import { TARIFF_VERSIONS, resolveTariffVersion, tableFor, type SemanalDayKind } from "./calendar";
import { resolveRegulatedPeriod } from "./classify";
import { toBilledPeriod, toDisplayPeriod } from "./collapse";
import type { Cycle, Season } from "./periods";

/** Offset of Europe/Lisbon at an instant, in minutes (west positive). */
function lisbonOffset(at: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Lisbon",
    timeZoneName: "longOffset",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(at);
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

/** An instant at a Lisbon wall-clock date and time ("YYYY-MM-DD", "HH:MM"). */
function lisbon(date: string, time: string): Date {
  const naive = Date.parse(`${date}T${time}:00Z`);
  // instant = naive - offset(instant). Iterate twice so instants inside the
  // DST transition hour settle; always re-anchor on `naive`.
  let instant = naive - lisbonOffset(new Date(naive)) * 60_000;
  instant = naive - lisbonOffset(new Date(instant)) * 60_000;
  return new Date(instant);
}

const semanalDayKinds: readonly SemanalDayKind[] = ["util", "sabado", "domingo"];
const cycles: readonly Cycle[] = ["diario", "semanal"];

describe("display collapse", () => {
  it("collapses vazio normal + super vazio into baixa", () => {
    expect(toDisplayPeriod("vazio normal")).toBe("baixa");
    expect(toDisplayPeriod("super vazio")).toBe("baixa");
    expect(toDisplayPeriod("cheias")).toBe("cheia");
    expect(toDisplayPeriod("ponta")).toBe("ponta");
  });

  it("billed collapse per option", () => {
    expect(toBilledPeriod("super vazio", "simples")).toBe("unico");
    expect(toBilledPeriod("ponta", "simples")).toBe("unico");
    expect(toBilledPeriod("super vazio", "bi-horario")).toBe("vazio");
    expect(toBilledPeriod("cheias", "bi-horario")).toBe("fora de vazio");
    expect(toBilledPeriod("ponta", "bi-horario")).toBe("fora de vazio");
    expect(toBilledPeriod("super vazio", "tri-horario")).toBe("vazio");
    expect(toBilledPeriod("cheias", "tri-horario")).toBe("cheias");
    expect(toBilledPeriod("ponta", "tri-horario")).toBe("ponta");
  });
});

describe("bracket table invariants", () => {
  it("brackets fall on quarter-hours and cover the day exactly once", () => {
    for (const version of TARIFF_VERSIONS) {
      for (const cycle of cycles) {
        const seasons: readonly Season[] = ["inverno", "verao"];
        const dayKinds: readonly (SemanalDayKind | undefined)[] =
          cycle === "diario" ? [undefined] : semanalDayKinds;
        for (const season of seasons) {
          for (const dayKind of dayKinds) {
            const label = `${version.id} ${cycle} ${season} ${dayKind}`;
            // Split midnight-wrapping brackets into two plain segments.
            const segments = tableFor(version, cycle, season, dayKind ?? "util").flatMap(
              (bracket) =>
                bracket.end > 1440
                  ? [
                      { start: 0, end: bracket.end - 1440 },
                      { start: bracket.start, end: 1440 },
                    ]
                  : [{ start: bracket.start, end: bracket.end }],
            );
            segments.sort((a, b) => a.start - b.start);

            let cursor = 0;
            for (const segment of segments) {
              expect(segment.start % 15, `${label} start at ${segment.start}`).toBe(0);
              expect(segment.end % 15, `${label} end at ${segment.end}`).toBe(0);
              expect(segment.start, `${label} gap before ${segment.start}`).toBe(cursor);
              cursor = segment.end;
            }
            expect(cursor, `${label} full-day coverage`).toBe(1440);
          }
        }
      }
    }
  });
});

describe("ciclo semanal classification", () => {
  it("winter weekdays: ponta 09:30–12:00 and 18:30–21:00", () => {
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "10:00"), "semanal")).toBe("ponta");
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "19:00"), "semanal")).toBe("ponta");
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "12:30"), "semanal")).toBe("cheias");
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "08:00"), "semanal")).toBe("cheias");
  });

  it("winter weekdays: vazio normal and super vazio", () => {
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "06:30"), "semanal")).toBe("vazio normal");
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "04:00"), "semanal")).toBe("super vazio");
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "22:30"), "semanal")).toBe("cheias");
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "01:00"), "semanal")).toBe("vazio normal");
  });

  it("summer weekdays: ponta 09:15–12:15, cheias elsewhere 07:00–24:00", () => {
    expect(resolveRegulatedPeriod(lisbon("2026-07-15", "10:00"), "semanal")).toBe("ponta");
    expect(resolveRegulatedPeriod(lisbon("2026-07-15", "12:00"), "semanal")).toBe("ponta");
    expect(resolveRegulatedPeriod(lisbon("2026-07-15", "12:30"), "semanal")).toBe("cheias");
    expect(resolveRegulatedPeriod(lisbon("2026-07-15", "07:00"), "semanal")).toBe("cheias");
    expect(resolveRegulatedPeriod(lisbon("2026-07-15", "19:00"), "semanal")).toBe("cheias");
    expect(resolveRegulatedPeriod(lisbon("2026-07-15", "23:00"), "semanal")).toBe("cheias");
  });

  it("saturdays have cheias but no ponta", () => {
    expect(resolveRegulatedPeriod(lisbon("2026-02-07", "10:00"), "semanal")).toBe("cheias");
    expect(resolveRegulatedPeriod(lisbon("2026-02-07", "20:00"), "semanal")).toBe("cheias");
    expect(resolveRegulatedPeriod(lisbon("2026-02-07", "15:00"), "semanal")).toBe("vazio normal");
    expect(resolveRegulatedPeriod(lisbon("2026-07-18", "10:00"), "semanal")).toBe("cheias");
    expect(resolveRegulatedPeriod(lisbon("2026-07-18", "21:00"), "semanal")).toBe("cheias");
  });

  it("sundays are entirely vazio", () => {
    expect(resolveRegulatedPeriod(lisbon("2026-02-08", "12:00"), "semanal")).toBe("vazio normal");
    expect(resolveRegulatedPeriod(lisbon("2026-02-08", "04:00"), "semanal")).toBe("super vazio");
    expect(resolveRegulatedPeriod(lisbon("2026-07-19", "20:00"), "semanal")).toBe("vazio normal");
  });
});

describe("ciclo diário classification", () => {
  it("winter: ponta 09:00–10:30 and 18:00–20:30", () => {
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "09:30"), "diario")).toBe("ponta");
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "19:00"), "diario")).toBe("ponta");
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "08:30"), "diario")).toBe("cheias");
  });

  it("summer: ponta 10:30–13:00 and 19:30–21:00", () => {
    expect(resolveRegulatedPeriod(lisbon("2026-07-15", "11:00"), "diario")).toBe("ponta");
    expect(resolveRegulatedPeriod(lisbon("2026-07-15", "20:00"), "diario")).toBe("ponta");
    expect(resolveRegulatedPeriod(lisbon("2026-07-15", "10:00"), "diario")).toBe("cheias");
  });

  it("vazio 22:00–08:00 with super vazio 02:00–06:00, both seasons", () => {
    for (const date of ["2026-02-04", "2026-07-15"]) {
      expect(resolveRegulatedPeriod(lisbon(date, "23:00"), "diario")).toBe("vazio normal");
      expect(resolveRegulatedPeriod(lisbon(date, "03:00"), "diario")).toBe("super vazio");
      expect(resolveRegulatedPeriod(lisbon(date, "07:00"), "diario")).toBe("vazio normal");
    }
  });
});

describe("boundary semantics", () => {
  it("start-inclusive / end-exclusive at bracket boundaries", () => {
    // Winter weekday semanal: ponta 09:30–12:00, cheias around it.
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "09:30"), "semanal")).toBe("ponta");
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "12:00"), "semanal")).toBe("cheias");
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "08:59"), "semanal")).toBe("cheias");
    // Midnight wrap: 22:00 starts vazio normal (diário winter 22:00–02:00).
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "21:59"), "diario")).toBe("cheias");
    expect(resolveRegulatedPeriod(lisbon("2026-02-04", "22:00"), "diario")).toBe("vazio normal");
  });
});

describe("daylight saving time", () => {
  it("fall-back day: both occurrences of the repeated hour classify by wall clock", () => {
    // 2026-10-25 is the last Sunday of October; wall-clock 01:00–02:00 occurs
    // twice — once in hora legal de verão (WEST, +01:00) and once in inverno
    // (WET, +00:00). Each occurrence must classify by its own wall-clock label.
    const first = new Date(Date.parse("2026-10-25T00:30:00Z"));
    const second = new Date(Date.parse("2026-10-25T01:30:00Z"));
    expect(lisbonOffset(first)).toBe(60); // still hora legal de verão
    expect(lisbonOffset(second)).toBe(0); // already hora legal de inverno
    expect(resolveRegulatedPeriod(first, "semanal")).toBe("vazio normal");
    expect(resolveRegulatedPeriod(second, "semanal")).toBe("vazio normal");
  });

  it("spring-forward day: instants near the missing hour classify fine", () => {
    // 2026-03-29 is the last Sunday of March; 02:00–03:00 does not exist.
    expect(resolveRegulatedPeriod(lisbon("2026-03-29", "03:30"), "semanal")).toBe("super vazio");
  });
});

describe("version selection", () => {
  it("resolves the version in force by Lisbon date", () => {
    expect(resolveTariffVersion(lisbon("2026-02-04", "10:00")).id).toBe("diretiva-1-2026");
  });

  it("rejects instants before the oldest checked-in version", () => {
    expect(() => resolveRegulatedPeriod(lisbon("2025-12-31", "10:00"), "semanal")).toThrow(
      /No tariff version/,
    );
  });

  it("honours an explicit version override outside the validity window", () => {
    expect(
      resolveRegulatedPeriod(lisbon("2025-12-31", "10:00"), "semanal", {
        versionId: "diretiva-1-2026",
      }),
    ).toBe("ponta");
  });

  it("rejects unknown version ids", () => {
    expect(() =>
      resolveRegulatedPeriod(lisbon("2026-02-04", "10:00"), "semanal", {
        versionId: "diretiva-9-9999",
      }),
    ).toThrow(/Unknown tariff version/);
  });
});

describe("display composition", () => {
  it("always yields one of the 3 display periods, for every option path", () => {
    // Sunday noon: vazio normal for semanal → baixa even for simples/bi.
    const at = lisbon("2026-02-08", "12:00");
    const regulated = resolveRegulatedPeriod(at, "semanal");
    expect(toDisplayPeriod(regulated)).toBe("baixa");
    expect(toBilledPeriod(regulated, "simples")).toBe("unico");
    expect(toBilledPeriod(regulated, "bi-horario")).toBe("vazio");
  });
});
