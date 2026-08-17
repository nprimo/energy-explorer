import type { RequestHandler } from "./$types";
import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { getDistinctMonths, getReadingsForMonth } from "$lib/server/db/readings.js";
import { lisbonParts } from "$lib/server/lisbon-tz.js";

const REGISTER = "A+";
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface MonthPoint {
  dayOfWeek: number; // Mon=1 .. Sun=7
  hour: number; // 0-23 (Lisbon)
  minute: number; // 0-59
  hourFloat: number; // e.g. 14.25 for 14:15
  valueWh: number;
}

export interface MonthPayload {
  monthIso: string;
  year: number;
  month: number;
  label: string;
  points: MonthPoint[];
}

function dedupNewestPerCalendarMonth(months: string[]): string[] {
  const seen = new Set<number>();
  const chosen: string[] = [];
  for (const m of months) {
    const mn = Number.parseInt(m.slice(5, 7), 10);
    if (Number.isNaN(mn) || seen.has(mn)) continue;
    seen.add(mn);
    chosen.push(m);
  }
  return chosen;
}

function buildMonth(cpe: string, m: string): MonthPayload {
  const rows = getReadingsForMonth(cpe, REGISTER, m);
  const points: MonthPoint[] = [];
  for (const r of rows) {
    const p = lisbonParts(r.ts);
    if (!p) continue;
    const hour = Math.floor(p.minuteOfDay / 60);
    const minute = p.minuteOfDay % 60;
    points.push({
      dayOfWeek: p.dayOfWeek,
      hour,
      minute,
      hourFloat: p.minuteOfDay / 60,
      valueWh: r.valueWh,
    });
  }
  const year = Number.parseInt(m.slice(0, 4), 10);
  const mn = Number.parseInt(m.slice(5, 7), 10);
  return {
    monthIso: m,
    year,
    month: mn,
    label: `${MONTH_LABELS[mn - 1]} ${year}`,
    points,
  };
}

export const GET: RequestHandler = async () => {
  const cpe = env.EREDES_CPE;
  if (!cpe) throw error(500, "Missing EREDES_CPE env var.");

  const distinct = getDistinctMonths(cpe, REGISTER);
  const chosen = dedupNewestPerCalendarMonth(distinct);
  const months = chosen.map((m) => buildMonth(cpe, m));

  return json({ cpe, register: REGISTER, months });
};
