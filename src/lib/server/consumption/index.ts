import { Context, Effect, Layer } from "effect";
import { ERedes, type ERedesServiceError } from "$lib/server/eredes";
import { NewReading, ReadingsRepo, type ReadingRow } from "$lib/server/readings";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REGISTER = "A+";
const EXPECTED_READINGS_PER_DAY = 96;

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type ConsumptionSource = "cache" | "api" | "partial";

export interface GatewayResult {
  readonly rows: ReadonlyArray<ReadingRow>;
  readonly source: ConsumptionSource;
  /** Days in `[start, end)` that were fetched from e-redes this call. */
  readonly fetchedDays: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ConsumptionGateway extends Context.Service<
  ConsumptionGateway,
  {
    /**
     * Return readings for `[start, end)` (local-midnight Dates), backfilling any
     * missing days from e-redes. With `{ refresh: true }` the whole range is
     * re-pulled.
     */
    readonly get: (
      cpe: string,
      start: Date,
      end: Date,
      options?: { readonly refresh?: boolean },
    ) => Effect.Effect<GatewayResult, ERedesServiceError>;

    /** Return the readings already cached for each day in `[start, end)`. */
    readonly getDailyCounts: (
      cpe: string,
      start: Date,
      end: Date,
      register?: string,
    ) => Effect.Effect<ReadonlyArray<{ readonly day: string; readonly count: number }>>;
  }
>()("app/ConsumptionGateway") {
  static readonly Live: Layer.Layer<ConsumptionGateway, never, ERedes | ReadingsRepo> =
    Layer.effect(
      ConsumptionGateway,
      Effect.gen(function* () {
        const eredes = yield* ERedes;
        const repo = yield* ReadingsRepo;

        const getDailyCounts: (typeof ConsumptionGateway)["Service"]["getDailyCounts"] = (
          cpe,
          start,
          end,
          register = REGISTER,
        ) => repo.countsByDate(cpe, register, start.toISOString(), end.toISOString());

        const get: (typeof ConsumptionGateway)["Service"]["get"] = (cpe, start, end, options) =>
          Effect.gen(function* () {
            const startIso = start.toISOString();
            const endIso = end.toISOString();
            yield* Effect.logInfo(
              `consumption request: cpe=${cpe} range=[${startIso} → ${endIso}] refresh=${options?.refresh === true}`,
            );

            // A day is cached only when its complete 15-minute curve is present.
            // Partial days must be fetched again so the upsert can fill the gaps.
            let missing: ReadonlyArray<{ start: Date; end: Date }>;
            let hadCache: boolean;
            if (options?.refresh) {
              missing = [{ start, end }];
              hadCache = false;
            } else {
              const counts = yield* repo.countsByDate(cpe, REGISTER, startIso, endIso);
              hadCache = counts.length > 0;
              missing = missingDayBlocks(
                start,
                end,
                new Map(counts.map(({ day, count }) => [day, count])),
              );
            }

            // Backfill each contiguous missing block from e-redes.
            const fetchedDays: string[] = [];
            for (const block of missing) {
              const fetched = yield* eredes.getConsumption(cpe, block.start, block.end);
              yield* repo.upsert(fetched.readings.map((r) => toNewReading(cpe, r)));
              for (const day of daysInRange(block.start, block.end)) fetchedDays.push(day);
            }

            const rows = yield* repo.getRange(cpe, REGISTER, startIso, endIso);

            const source: ConsumptionSource =
              missing.length === 0 ? "cache" : hadCache ? "partial" : "api";

            yield* Effect.logInfo(
              `consumption ok: cpe=${cpe} range=[${startIso} → ${endIso}] source=${source} rows=${rows.length} fetchedDays=${fetchedDays.length}`,
            );
            return { rows, source, fetchedDays };
          }).pipe(
            Effect.catchTags({
              ERedesAuthenticationError: (err) =>
                Effect.gen(function* () {
                  yield* Effect.logError(
                    `consumption failed: cpe=${cpe} range=[${start.toISOString()} → ${end.toISOString()}] ${err._tag}: ${err.message}`,
                  );
                  return yield* Effect.fail(err);
                }),
              ERedesConnectionError: (err) =>
                Effect.gen(function* () {
                  yield* Effect.logError(
                    `consumption failed: cpe=${cpe} range=[${start.toISOString()} → ${end.toISOString()}] ${err._tag}: ${err.message}`,
                  );
                  return yield* Effect.fail(err);
                }),
              ERedesError: (err) =>
                Effect.gen(function* () {
                  yield* Effect.logError(
                    `consumption failed: cpe=${cpe} range=[${start.toISOString()} → ${end.toISOString()}] ${err._tag}: ${err.message}`,
                  );
                  return yield* Effect.fail(err);
                }),
            }),
            Effect.withSpan("ConsumptionGateway.get", {
              attributes: {
                cpe,
                start: start.toISOString(),
                end: end.toISOString(),
                refresh: options?.refresh === true,
              },
            }),
          );

        return ConsumptionGateway.of({ get, getDailyCounts });
      }),
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNewReading(
  cpe: string,
  r: { readonly timestamp: string; readonly valueWh: number; readonly status: string },
): NewReading {
  return new NewReading({
    cpe,
    register: REGISTER,
    ts: r.timestamp,
    valueWh: r.valueWh,
    status: r.status,
  });
}

/** Format a Date as `YYYY-MM-DD` using UTC. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** All calendar days `[start, end)` as `YYYY-MM-DD` (UTC-based). */
function daysInRange(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const limit = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cur < limit) {
    out.push(dayKey(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Compute contiguous `[dayStart, dayEnd)` blocks (as Dates) of days in
 * `[start, end)` that are absent or have an incomplete reading curve.
 *
 * All dates and day keys use UTC consistently.
 */
function missingDayBlocks(
  start: Date,
  end: Date,
  readingCounts: Map<string, number>,
): Array<{ start: Date; end: Date }> {
  const blocks: Array<{ start: Date; end: Date }> = [];
  let blockStart: Date | null = null;

  const allDays = daysInRange(start, end);
  for (const day of allDays) {
    if ((readingCounts.get(day) ?? 0) >= EXPECTED_READINGS_PER_DAY) {
      if (blockStart !== null) {
        blocks.push({ start: blockStart, end: dayToDate(day, 1) });
        blockStart = null;
      }
    } else {
      if (blockStart === null) blockStart = dayToDate(day, 0);
    }
  }
  if (blockStart !== null) {
    blocks.push({ start: blockStart, end });
  }
  return blocks;
}

/** Build a Date at UTC midnight offset by `addDays` for the given `YYYY-MM-DD`. */
function dayToDate(day: string, addDays: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + addDays);
  return dt;
}
