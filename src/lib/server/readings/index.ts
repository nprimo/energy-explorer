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

    /** Upsert readings; rows are matched on (cpe, register, ts). */
    readonly upsert: (rows: ReadonlyArray<NewReading>) => Effect.Effect<number>;

    /**
     * Distinct calendar days (`YYYY-MM-DD`) with at least one reading in
     * `[start, end)` (ISO-8601 UTC).
     *
     * INFO: day presence is derived from `substr(ts,1,10)` of the UTC ts, while
     * the gateway's start/end come from local (PT) midnight. PT is UTC±0/+1, so
     * the ±1h offset is ignored. Acceptable for this single-region app.
     */
    readonly daysPresent: (
      cpe: string,
      register: string,
      start: string,
      end: string,
    ) => Effect.Effect<ReadonlyArray<string>>;
  }
>()("app/ReadingsRepo") {
  static readonly Live: Layer.Layer<ReadingsRepo> = Layer.sync(ReadingsRepo, () =>
    ReadingsRepo.of({
      getRange: (cpe, register, start, end) =>
        Effect.sync(() => {
          const db = getDb();
          return db.prepare(GET_RANGE_SQL).all({ cpe, register, start, end }) as ReadingRow[];
        }),

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
        }),

      daysPresent: (cpe, register, start, end) =>
        Effect.sync(() => {
          const db = getDb();
          const rows = db.prepare(DAYS_PRESENT_SQL).all({ cpe, register, start, end }) as {
            day: string;
          }[];
          return rows.map((r) => r.day);
        }),
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

const DAYS_PRESENT_SQL = `
	SELECT DISTINCT substr(ts, 1, 10) AS day
	FROM readings
	WHERE cpe = @cpe
	  AND register = @register
	  AND ts >= @start
	  AND ts < @end
	ORDER BY day ASC
`;
