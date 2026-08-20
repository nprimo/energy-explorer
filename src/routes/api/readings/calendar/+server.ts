import { error, json } from "@sveltejs/kit";
import { Effect } from "effect";
import type { RequestHandler } from "./$types";
import { ConsumptionGateway } from "$lib/server/consumption";
import { run } from "$lib/server/runtime";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(value: string | null): Date | null {
  if (!value) return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export const GET: RequestHandler = async ({ url }) => {
  const cpe = url.searchParams.get("cpe")?.trim();
  const register = url.searchParams.get("register")?.trim() || "A+";
  const start = parseDay(url.searchParams.get("start"));
  const end = parseDay(url.searchParams.get("end"));

  if (!cpe) throw error(400, "Missing cpe.");
  if (!start || !end) throw error(400, "Invalid date. Use YYYY-MM-DD.");
  if (start >= end) throw error(400, "end must be after start");

  const dailyCounts = await run(
    Effect.gen(function* () {
      const gateway = yield* ConsumptionGateway;
      return yield* gateway.getDailyCounts(cpe, start, end, register);
    }),
  );

  return json({
    cpe,
    register,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    counts: Object.fromEntries(dailyCounts.map(({ day, count }) => [day, count])),
  });
};
