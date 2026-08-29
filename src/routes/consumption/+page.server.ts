import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { env } from "$env/dynamic/private";
import { Effect } from "effect";
import { run } from "$lib/server/runtime";
import { ReadingsRepo } from "$lib/server/readings";
import { computeDailyProfile } from "$lib/consumption/profile";

const REGISTER = "A+";
const DAYS = 30;

export const load: PageServerLoad = async () => {
  const cpe = env.EREDES_CPE;
  if (!cpe) {
    throw error(500, "Missing EREDES_CPE env var. Copy .env.example to .env.");
  }

  // Cache-only read: never triggers an e-redes backfill.
  const program = Effect.gen(function* () {
    const repo = yield* ReadingsRepo;
    return yield* repo.getLatestDays(cpe, REGISTER, DAYS);
  }).pipe(
    // DB failures are defects (Effect.sync throws); surface them as a 500.
    Effect.catchDefect((defect) =>
      Effect.sync(() => {
        throw error(500, `Could not load readings: ${String(defect)}`);
      }),
    ),
  );

  const result = await run(program);

  const profile = computeDailyProfile(
    result.rows.map((row) => ({ timestamp: row.ts, valueWh: row.valueWh })),
  );

  return {
    days: DAYS,
    profile,
    range: {
      start: result.days[0] ?? null,
      end: result.days[result.days.length - 1] ?? null,
      count: result.rows.length,
      dayCount: result.days.length,
    },
  };
};
