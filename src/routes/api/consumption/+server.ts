import type { RequestHandler } from "./$types";
import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { Effect } from "effect";
import { run } from "$lib/server/runtime";
import {
  ERedes,
  ERedesAuthenticationError,
  ERedesConnectionError,
  ERedesError,
  type ConsumptionData,
} from "$lib/server/eredes";
import { getReadingsRange, upsertReadings, type ReadingRow } from "$lib/server/db/readings.js";

const REGISTER = "A+";

function parseDateParam(value: string | null, fallback: Date): Date | null {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function toIsoUtc(d: Date): string {
  return d.toISOString();
}

function rowToJson(r: ReadingRow) {
  return {
    timestamp: r.ts,
    valueWh: r.valueWh,
    status: r.status,
  };
}

function fetchAndCache(
  cpe: string,
  start: Date,
  end: Date,
): Effect.Effect<
  { rows: ReadingRow[]; fetched: ConsumptionData },
  ERedesAuthenticationError | ERedesConnectionError | ERedesError,
  ERedes
> {
  return Effect.gen(function* () {
    const eredes = yield* ERedes;
    const fetched = yield* eredes.getConsumption(cpe, start, end);
    const newRows = fetched.readings.map((r) => ({
      cpe,
      register: REGISTER,
      ts: r.timestamp,
      valueWh: r.valueWh,
      status: r.status,
    }));
    upsertReadings(newRows);
    const rows = getReadingsRange(cpe, REGISTER, toIsoUtc(start), toIsoUtc(end));
    return { rows, fetched };
  });
}

export const GET: RequestHandler = async ({ url }) => {
  const cpe = env.EREDES_CPE;
  const aat = env.EREDES_AAT;
  if (!cpe || !aat) {
    throw error(500, "Missing EREDES_CPE or EREDES_AAT env vars. Copy .env.example to .env.");
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const start = parseDateParam(url.searchParams.get("start"), yesterday);
  const end = parseDateParam(url.searchParams.get("end"), today);
  if (!start || !end) throw error(400, "Invalid date. Use YYYY-MM-DD.");
  if (start > end) throw error(400, "start must be <= end");

  const refresh = url.searchParams.get("refresh") === "1";
  const startIso = toIsoUtc(start);
  const endIso = toIsoUtc(end);

  let rows = getReadingsRange(cpe, REGISTER, startIso, endIso);
  let source: "cache" | "api" = "cache";

  if (refresh || rows.length === 0) {
    try {
      const res = await run(
        Effect.gen(function* () {
          return yield* fetchAndCache(cpe, start, end);
        }),
      );
      rows = res.rows;
      source = "api";
    } catch (ex) {
      if (ex instanceof ERedesAuthenticationError) throw error(401, ex.message);
      if (ex instanceof ERedesConnectionError) throw error(502, ex.message);
      if (ex instanceof ERedesError) throw error(502, ex.message);
      throw ex;
    }
  }

  return json({
    cpe,
    register: REGISTER,
    startDate: startIso,
    endDate: endIso,
    source,
    count: rows.length,
    readings: rows.map(rowToJson),
  });
};
