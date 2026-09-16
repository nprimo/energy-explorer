import { Context, Effect, Layer, Schema } from "effect";
import { getDb } from "../db/index.js";

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export class ReadingRow extends Schema.Class<ReadingRow>("readings/ReadingRow")({
  cpe: Schema.String,
  register: Schema.String,
  ts: Schema.String,
  valueWh: Schema.Number,
  status: Schema.String,
  insertedAt: Schema.String,
}) {}

export interface LatestDaysResult {
  /** Available days (YYYY-MM-DD UTC), ordered oldest → newest. */
  readonly days: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadingRow>;
}

export class NewReading extends Schema.Class<NewReading>("readings/NewReading")({
  cpe: Schema.String,
  register: Schema.String,
  ts: Schema.String,
  valueWh: Schema.Number,
  status: Schema.String,
}) {}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ReadingsRepo extends Context.Service<
  ReadingsRepo,
  {
    /** Read cached readings in `[start, end)` (ISO-8601 UTC), ordered by ts. */
    readonly getRange: (
      cpe: string,
      register: string,
      start: string,
      end: string,
    ) => Effect.Effect<ReadonlyArray<ReadingRow>>;

    /**
     * First and last timestamp (UTC ISO-8601) of the cached readings for a
     * CPE/register; both null when there is no data.
     */
    readonly getRangeBounds: (
      cpe: string,
      register: string,
    ) => Effect.Effect<{ min: string | null; max: string | null }>;

    /** Upsert readings; rows are matched on (cpe, register, ts). */
    readonly upsert: (rows: ReadonlyArray<NewReading>) => Effect.Effect<number>;

    /** Number of readings for each UTC calendar day in `[start, end)`. Days with no rows are omitted. */
    readonly countsByDate: (
      cpe: string,
      register: string,
      start: string,
      end: string,
    ) => Effect.Effect<ReadonlyArray<{ readonly day: string; readonly count: number }>>;

    /**
     * The `days` most recent UTC calendar days that have cached readings, and
     * all readings on those days, ordered by ts. Reads the cache only — never
     * backfills from e-redes.
     */
    readonly getLatestDays: (
      cpe: string,
      register: string,
      days: number,
    ) => Effect.Effect<LatestDaysResult>;
  }
>()("app/ReadingsRepo") {
  static readonly Live: Layer.Layer<ReadingsRepo> = Layer.sync(ReadingsRepo, () =>
    ReadingsRepo.of({
      getRange: (cpe, register, start, end) =>
        Effect.sync(() => {
          const db = getDb();
          return db.prepare(GET_RANGE_SQL).all({ cpe, register, start, end }) as ReadingRow[];
        }).pipe(
          Effect.withSpan("ReadingsRepo.getRange", {
            attributes: { cpe, register, start, end },
          }),
        ),

      getRangeBounds: (cpe, register) =>
        Effect.sync(() => {
          const db = getDb();
          const row = db.prepare(GET_RANGE_BOUNDS_SQL).get({ cpe, register }) as {
            min: string | null;
            max: string | null;
          };
          return { min: row.min ?? null, max: row.max ?? null };
        }).pipe(
          Effect.withSpan("ReadingsRepo.getRangeBounds", {
            attributes: { cpe, register },
          }),
        ),

      upsert: (rows) =>
        Effect.sync(() => {
          if (rows.length === 0) return 0;
          const db = getDb();
          const stmt = db.prepare(UPSERT_SQL);
          const now = new Date().toISOString();
          const tx = db.transaction((items: ReadonlyArray<NewReading>) => {
            let n = 0;
            for (const r of items) {
              stmt.run({
                cpe: r.cpe,
                register: r.register,
                ts: r.ts,
                valueWh: r.valueWh,
                status: r.status,
                insertedAt: now,
              });
              n++;
            }
            return n;
          });
          return tx(rows);
        }).pipe(
          Effect.tap((written) =>
            Effect.logInfo(`db write: ${rows.length} rows (${written} upserts)`),
          ),
          Effect.withSpan("ReadingsRepo.upsert", {
            attributes: { rows: rows.length },
          }),
        ),

      countsByDate: (cpe, register, start, end) =>
        Effect.sync(() => {
          const db = getDb();
          return db.prepare(COUNTS_BY_DATE_SQL).all({ cpe, register, start, end }) as {
            day: string;
            count: number;
          }[];
        }).pipe(
          Effect.tap((counts) =>
            Effect.logInfo(`db probe: cpe=${cpe} range=[${start} → ${end}] days=${counts.length}`),
          ),
          Effect.withSpan("ReadingsRepo.countsByDate", {
            attributes: { cpe, register, start, end },
          }),
        ),

      getLatestDays: (cpe, register, days) =>
        Effect.sync(() => {
          const db = getDb();
          const found = db.prepare(LATEST_DAYS_SQL).all({ cpe, register, limit: days }) as {
            day: string;
          }[];
          if (found.length === 0) return { days: [], rows: [] } satisfies LatestDaysResult;

          // `found` is newest-first; the oldest available day bounds the range.
          // Every day with rows inside [oldest, newest] is among the N most
          // recent by construction, so a range fetch returns exactly those days.
          const start = `${found[found.length - 1].day}T00:00:00Z`;
          const end = `${nextDay(found[0].day)}T00:00:00Z`;
          const rows = db.prepare(GET_RANGE_SQL).all({ cpe, register, start, end }) as ReadingRow[];
          return {
            days: found.map((r) => r.day).reverse(),
            rows,
          } satisfies LatestDaysResult;
        }).pipe(
          Effect.tap((result) =>
            Effect.logInfo(
              `db latest days: cpe=${cpe} requested=${days} days=${result.days.length} rows=${result.rows.length}`,
            ),
          ),
          Effect.withSpan("ReadingsRepo.getLatestDays", {
            attributes: { cpe, register, days },
          }),
        ),
    }),
  );
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const UPSERT_SQL = `
	INSERT INTO readings (cpe, register, ts, value_wh, status, inserted_at)
	VALUES (@cpe, @register, @ts, @valueWh, @status, @insertedAt)
	ON CONFLICT(cpe, register, ts) DO UPDATE SET
		value_wh    = excluded.value_wh,
		status      = excluded.status,
		inserted_at = excluded.inserted_at
`;

const GET_RANGE_SQL = `
	SELECT
		cpe           AS cpe,
		register      AS register,
		ts            AS ts,
		value_wh      AS valueWh,
		status        AS status,
		inserted_at   AS insertedAt
	FROM readings
	WHERE cpe = @cpe
	  AND register = @register
	  AND ts >= @start
	  AND ts < @end
	ORDER BY ts ASC
`;

/** The calendar day after `day` (YYYY-MM-DD), via UTC. */
function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

const GET_RANGE_BOUNDS_SQL = `
	SELECT MIN(ts) AS min, MAX(ts) AS max
	FROM readings
	WHERE cpe = @cpe
	  AND register = @register
`;

const COUNTS_BY_DATE_SQL = `
	SELECT substr(ts, 1, 10) AS day, COUNT(*) AS count
	FROM readings
	WHERE cpe = @cpe
	  AND register = @register
	  AND ts >= @start
	  AND ts < @end
	GROUP BY day
	ORDER BY day ASC
`;

const LATEST_DAYS_SQL = `
	SELECT DISTINCT substr(ts, 1, 10) AS day
	FROM readings
	WHERE cpe = @cpe
	  AND register = @register
	ORDER BY day DESC
	LIMIT @limit
`;
