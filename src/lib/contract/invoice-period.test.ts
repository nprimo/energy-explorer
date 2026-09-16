// Tests for invoice-period arithmetic: monthly derivation from the anchor
// date, 29/30/31 clamping (Feb, leap years, 30-day months), the partial first
// period on a contract switch, and DST boundary periods. See
// docs/contract-invoice-plan.md — "Invoice period".

import { expect, describe, it } from "vite-plus/test";
import { currentInvoicePeriod, invoicePeriodAt, lisbonMidnightUtc } from "./invoice-period";

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
  let instant = naive - lisbonOffset(new Date(naive)) * 60_000;
  instant = naive - lisbonOffset(new Date(instant)) * 60_000;
  return new Date(instant);
}

describe("monthly derivation from the anchor date", () => {
  it("the plan's worked example: anchor Dec 31 → Feb clamps to Feb 28", () => {
    // Periods start Dec 31, Jan 31, Feb 28, Mar 31, Apr 30 — the anchor's day
    // returns as soon as the month has it (no permanent drift).
    expect(invoicePeriodAt("2025-12-31", "2025-12-31", lisbon("2026-01-10", "12:00"))).toEqual({
      start: "2025-12-31T00:00:00Z",
      end: "2026-01-31T00:00:00Z",
    });
    expect(invoicePeriodAt("2025-12-31", "2025-12-31", lisbon("2026-02-10", "12:00"))).toEqual({
      start: "2026-01-31T00:00:00Z",
      end: "2026-02-28T00:00:00Z",
    });
    expect(invoicePeriodAt("2025-12-31", "2025-12-31", lisbon("2026-03-05", "12:00"))).toEqual({
      start: "2026-02-28T00:00:00Z",
      // Mar 31 00:00 is hora legal de verão (WEST) → 23:00Z the day before.
      end: "2026-03-30T23:00:00Z",
    });
    expect(invoicePeriodAt("2025-12-31", "2025-12-31", lisbon("2026-04-05", "12:00"))).toEqual({
      start: "2026-03-30T23:00:00Z",
      end: "2026-04-29T23:00:00Z",
    });
  });

  it("Feb-29 anchor clamps to Feb 28 in non-leap years and restores Feb 29 in leap years", () => {
    expect(lisbonMidnightUtc("2024-02-29")).toBe("2024-02-29T00:00:00Z");
    // 2025: the clamped occurrence is Feb 28; at Mar 5 the period containing
    // it runs Feb 28 → Mar 29 (DST starts Mar 30, 2025, so both are WET).
    expect(invoicePeriodAt("2024-02-29", "2024-02-29", lisbon("2025-03-05", "12:00"))).toEqual({
      start: "2025-02-28T00:00:00Z",
      end: "2025-03-29T00:00:00Z",
    });
    // 2028 is a leap year: the anchor's own day is used again.
    expect(invoicePeriodAt("2024-02-29", "2024-02-29", lisbon("2028-03-01", "12:00"))).toEqual({
      start: "2028-02-29T00:00:00Z",
      end: "2028-03-28T23:00:00Z", // Mar 29 00:00 WEST
    });
  });

  it("anchor day 30 clamps in February (28/29) but not in 30-day months", () => {
    expect(invoicePeriodAt("2026-01-30", "2026-01-30", lisbon("2026-02-15", "12:00"))).toEqual({
      start: "2026-01-30T00:00:00Z",
      end: "2026-02-28T00:00:00Z",
    });
    expect(invoicePeriodAt("2026-01-30", "2026-01-30", lisbon("2026-04-15", "12:00"))).toEqual({
      start: "2026-03-29T23:00:00Z", // Mar 30 00:00 WEST
      end: "2026-04-29T23:00:00Z", // Apr 30 00:00 WEST
    });
  });

  it("leap-year February clamps 29 anchors to Feb 29 itself", () => {
    expect(invoicePeriodAt("2026-01-29", "2026-01-29", lisbon("2028-02-15", "12:00"))).toEqual({
      start: "2028-01-29T00:00:00Z",
      end: "2028-02-29T00:00:00Z",
    });
  });
});

describe("partial first period (contract switch mid-cycle)", () => {
  it("validFrom before the next anchor occurrence bills a partial first period", () => {
    // Anchor day 15, switch on Jan 20 → first period runs Jan 20 → Feb 15.
    expect(invoicePeriodAt("2026-01-15", "2026-01-20", lisbon("2026-01-25", "12:00"))).toEqual({
      start: "2026-01-20T00:00:00Z",
      end: "2026-02-15T00:00:00Z",
    });
    // Full periods afterwards.
    expect(invoicePeriodAt("2026-01-15", "2026-01-20", lisbon("2026-02-20", "12:00"))).toEqual({
      start: "2026-02-15T00:00:00Z",
      end: "2026-03-15T00:00:00Z",
    });
  });

  it("validFrom on the anchor date starts a full period", () => {
    expect(invoicePeriodAt("2026-01-15", "2026-01-15", lisbon("2026-01-16", "12:00"))).toEqual({
      start: "2026-01-15T00:00:00Z",
      end: "2026-02-15T00:00:00Z",
    });
  });

  it("validFrom before the anchor date itself runs to the anchor occurrence", () => {
    // Switched Nov 20, cycle anchored on Dec 31 → partial period Nov 20 → Dec 31.
    expect(invoicePeriodAt("2025-12-31", "2025-11-20", lisbon("2025-11-25", "12:00"))).toEqual({
      start: "2025-11-20T00:00:00Z",
      end: "2025-12-31T00:00:00Z",
    });
  });

  it("validFrom exactly on a clamped occurrence starts a full period there", () => {
    // Anchor Dec 31: February's occurrence is the clamped Feb 28.
    expect(invoicePeriodAt("2025-12-31", "2026-02-28", lisbon("2026-03-01", "12:00"))).toEqual({
      start: "2026-02-28T00:00:00Z",
      end: "2026-03-30T23:00:00Z", // Mar 31 00:00 WEST
    });
  });

  it("throws when there is no period containing the instant", () => {
    expect(() =>
      invoicePeriodAt("2026-01-15", "2026-01-20", lisbon("2026-01-10", "12:00")),
    ).toThrow(/No invoice period contains/);
  });
});

describe("DST boundary periods", () => {
  it("spring-forward month: local midnight converts to true UTC (2026-03-29 is the transition)", () => {
    // Mar 29 00:00 is still hora legal de inverno (WET, +00:00).
    expect(lisbonMidnightUtc("2026-03-29")).toBe("2026-03-29T00:00:00Z");
    // Apr 29 00:00 is hora legal de verão (WEST, +01:00) → 23:00Z the day before.
    expect(invoicePeriodAt("2026-03-29", "2026-03-29", lisbon("2026-04-01", "12:00"))).toEqual({
      start: "2026-03-29T00:00:00Z",
      end: "2026-04-28T23:00:00Z",
    });
  });

  it("fall-back month: local midnight converts to true UTC (2026-10-25 is the transition)", () => {
    // Oct 25 00:00 is still hora legal de verão (WEST, +01:00).
    expect(lisbonMidnightUtc("2026-10-25")).toBe("2026-10-24T23:00:00Z");
    // Nov 25 00:00 is hora legal de inverno (WET, +00:00).
    expect(invoicePeriodAt("2026-10-25", "2026-10-25", lisbon("2026-11-01", "12:00"))).toEqual({
      start: "2026-10-24T23:00:00Z",
      end: "2026-11-25T00:00:00Z",
    });
  });
});

describe("currentInvoicePeriod", () => {
  it("is the latest period whose start is ≤ now, end projected", () => {
    const now = lisbon("2026-02-10", "18:30");
    expect(currentInvoicePeriod("2025-12-31", "2025-12-31", now)).toEqual({
      start: "2026-01-31T00:00:00Z",
      end: "2026-02-28T00:00:00Z",
    });
  });

  it("rejects malformed anchor dates", () => {
    expect(() =>
      currentInvoicePeriod("2026-13-40", "2026-01-15", lisbon("2026-02-10", "12:00")),
    ).toThrow(/Invalid Lisbon date/);
    expect(() =>
      currentInvoicePeriod("2026-02-30", "2026-01-15", lisbon("2026-02-10", "12:00")),
    ).toThrow(/Invalid Lisbon date/);
  });
});
