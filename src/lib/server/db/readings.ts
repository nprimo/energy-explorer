import { getDb } from "./index.js";

export interface ReadingRow {
  cpe: string;
  register: string;
  ts: string;
  valueWh: number;
  status: string;
  insertedAt: string;
}

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

const COUNT_RANGE_SQL = `
	SELECT COUNT(*) AS n
	FROM readings
	WHERE cpe = @cpe
	  AND register = @register
	  AND ts >= @start
	  AND ts < @end
`;

export type NewReading = Omit<ReadingRow, "insertedAt">;

export function upsertReadings(rows: NewReading[]): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(UPSERT_SQL);
  const now = new Date().toISOString();
  const tx = db.transaction((items: NewReading[]) => {
    let n = 0;
    for (const r of items) {
      stmt.run({ ...r, insertedAt: now });
      n++;
    }
    return n;
  });
  return tx(rows);
}

export function getReadingsRange(
  cpe: string,
  register: string,
  start: string,
  end: string,
): ReadingRow[] {
  const db = getDb();
  return db.prepare(GET_RANGE_SQL).all({ cpe, register, start, end }) as ReadingRow[];
}

export function countReadingsRange(
  cpe: string,
  register: string,
  start: string,
  end: string,
): number {
  const db = getDb();
  const row = db.prepare(COUNT_RANGE_SQL).get({ cpe, register, start, end }) as { n: number };
  return row.n;
}
