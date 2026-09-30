import type { RequestHandler } from "./$types";
import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { Effect } from "effect";
import { run } from "$lib/server/runtime";
import { eredesFailure, orHttpError } from "$lib/server/http";
import { ConsumptionGateway, type ConsumptionSource } from "$lib/server/consumption";

function parseDateParam(value: string | null, fallback: Date): Date | null {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function toIsoUtc(d: Date): string {
  return d.toISOString();
}

function rowToJson(r: { ts: string; valueWh: number; status: string }) {
  return {
    timestamp: r.ts,
    valueWh: r.valueWh,
    status: r.status,
  };
}

export const GET: RequestHandler = async ({ url }) => {
  const cpe = env.EREDES_CPE;
  const aat = env.EREDES_AAT;
  if (!cpe || !aat) {
    throw error(500, "Missing EREDES_CPE or EREDES_AAT env vars. Copy .env.example to .env.");
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const start = parseDateParam(url.searchParams.get("start"), yesterday);
  const end = parseDateParam(url.searchParams.get("end"), today);
  if (!start || !end) throw error(400, "Invalid date. Use YYYY-MM-DD.");
  if (start > end) throw error(400, "start must be <= end");

  const refresh = url.searchParams.get("refresh") === "1";
  const startIso = toIsoUtc(start);
  const endIso = toIsoUtc(end);

  const result: {
    rows: ReadonlyArray<{ ts: string; valueWh: number; status: string }>;
    source: ConsumptionSource;
    fetchedDays: ReadonlyArray<string>;
  } = await run(
    orHttpError(
      Effect.gen(function* () {
        const gateway = yield* ConsumptionGateway;
        return yield* gateway.get(cpe, start, end, { refresh });
      }),
      eredesFailure,
    ),
  );

  return json({
    cpe,
    register: "A+",
    startDate: startIso,
    endDate: endIso,
    source: result.source,
    count: result.rows.length,
    readings: result.rows.map(rowToJson),
    fetchedDays: [...result.fetchedDays],
  });
};
