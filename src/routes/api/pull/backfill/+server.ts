import type { RequestHandler } from "./$types";
import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { ERedesAuthenticationError, ERedesError } from "$lib/server/eredes";
import { pullDaysParallel, buildDayQueue } from "$lib/server/eredes-pull";
import { getLatestReadingDay } from "$lib/server/db/readings.js";

const REGISTER = "A+";
const DEFAULT_DAYS = 365;
const MAX_DAYS = 3650;

function utcYesterdayDay(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export const POST: RequestHandler = async ({ url }) => {
  const cpe = env.EREDES_CPE;
  const aat = env.EREDES_AAT;
  if (!cpe || !aat) {
    throw error(500, "Missing EREDES_CPE or EREDES_AAT env vars.");
  }

  const daysParam = Number.parseInt(url.searchParams.get("days") ?? "", 10);
  const days =
    Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, MAX_DAYS) : DEFAULT_DAYS;
  const concurrencyParam = Number.parseInt(url.searchParams.get("concurrency") ?? "", 10);
  const concurrency =
    Number.isFinite(concurrencyParam) && concurrencyParam > 0 ? concurrencyParam : undefined;

  const toDay = utcYesterdayDay();
  const fromDay = shiftDay(toDay, -(days - 1));
  const dayQueue = buildDayQueue(fromDay, toDay);

  let latestDay: string | null = null;
  try {
    latestDay = getLatestReadingDay(cpe, REGISTER);
  } catch {
    // empty DB is fine
  }

  try {
    const summary = await pullDaysParallel(aat, cpe, dayQueue, {
      concurrency,
      skipPresent: true,
    });
    return json({
      cpe,
      register: REGISTER,
      mode: "backfill",
      fromDay,
      toDay,
      latestDayBefore: latestDay,
      ...summary,
    });
  } catch (ex) {
    if (ex instanceof ERedesAuthenticationError) throw error(401, ex.message);
    if (ex instanceof ERedesError) throw error(502, ex.message);
    throw ex;
  }
};
