import type { RequestHandler } from "./$types";
import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { ERedesAuthenticationError, ERedesError } from "$lib/server/eredes";
import { pullDaysParallel, buildDayQueue } from "$lib/server/eredes-pull";
import { getLatestReadingDay } from "$lib/server/db/readings.js";

const REGISTER = "A+";

function utcYesterdayDay(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const POST: RequestHandler = async () => {
  const cpe = env.EREDES_CPE;
  const aat = env.EREDES_AAT;
  if (!cpe || !aat) {
    throw error(500, "Missing EREDES_CPE or EREDES_AAT env vars.");
  }

  const toDay = utcYesterdayDay();
  const latestDay = getLatestReadingDay(cpe, REGISTER);

  if (!latestDay) {
    return json({
      cpe,
      register: REGISTER,
      mode: "refresh",
      message: "no data yet - run backfill first",
      fromDay: null,
      toDay,
      latestDayBefore: null,
      requested: 0,
      fetched: 0,
      skipped: 0,
      failed: 0,
      results: [],
    });
  }

  // Re-pull from the latest day we have (in case the trailing day was partial)
  // through yesterday. Typically a small window (1-3 days). Don't skip present
  // days: keeps the last day fresh and the in-between days tiny.
  const dayQueue = buildDayQueue(latestDay, toDay);

  try {
    const summary = await pullDaysParallel(aat, cpe, dayQueue, {
      skipPresent: false,
    });
    return json({
      cpe,
      register: REGISTER,
      mode: "refresh",
      fromDay: latestDay,
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
