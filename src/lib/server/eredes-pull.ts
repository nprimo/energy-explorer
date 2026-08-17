import { ERedesClient, ERedesAuthenticationError, ERedesError } from "./eredes";
import { countReadingsForDay, upsertReadings } from "./db/readings.js";

const REGISTER = "A+";
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const JITTER_MS = 100;
const DEFAULT_CONCURRENCY = 4;

export interface DayResult {
  day: string; // YYYY-MM-DD
  ok: boolean;
  count: number;
  error?: string;
}

export interface PullSummary {
  requested: number;
  fetched: number;
  skipped: number;
  failed: number;
  results: DayResult[];
}

export interface PullOptions {
  concurrency?: number;
  skipPresent?: boolean;
}

function dayRange(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00Z`);
  const end = new Date(`${day}T24:00:00Z`);
  return { start, end };
}

function buildDayQueue(fromDay: string, toDay: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${fromDay}T00:00:00Z`);
  const end = new Date(`${toDay}T00:00:00Z`);
  while (cursor <= end) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cursor.getUTCDate()).padStart(2, "0");
    days.push(`${y}-${m}-${d}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchOneDay(client: ERedesClient, cpe: string, day: string): Promise<number> {
  const { start, end } = dayRange(day);
  const fetched = await client.getConsumption(cpe, start, end);
  const rows = fetched.readings.map((r) => ({
    cpe,
    register: REGISTER,
    ts: r.timestamp,
    valueWh: r.valueWh,
    status: r.status,
  }));
  upsertReadings(rows);
  return rows.length;
}

async function fetchWithRetry(
  client: ERedesClient,
  cpe: string,
  day: string,
): Promise<{ count: number; error?: string }> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const count = await fetchOneDay(client, cpe, day);
      return { count };
    } catch (ex) {
      // Auth errors are never retryable: token dead -> whole batch should stop.
      if (ex instanceof ERedesAuthenticationError) throw ex;
      lastErr = ex instanceof Error ? ex : new Error(String(ex));
      if (attempt < MAX_RETRIES) {
        const backoff =
          BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.floor(Math.random() * JITTER_MS);
        await sleep(backoff);
      }
    }
  }
  return { count: 0, error: lastErr?.message ?? "unknown error" };
}

export async function pullDaysParallel(
  accessToken: string,
  cpe: string,
  days: string[],
  opts: PullOptions = {},
): Promise<PullSummary> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const skipPresent = opts.skipPresent ?? false;

  const client = new ERedesClient(accessToken);
  const results: DayResult[] = Array.from({ length: days.length });
  let requested = 0;
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  let nextIndex = 0;
  const workers: Promise<void>[] = [];

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= days.length) return;
      const day = days[i];
      requested++;

      if (skipPresent && countReadingsForDay(cpe, REGISTER, day) > 0) {
        results[i] = { day, ok: true, count: 0 };
        skipped++;
        continue;
      }

      try {
        const { count, error } = await fetchWithRetry(client, cpe, day);
        if (error) {
          results[i] = { day, ok: false, count: 0, error };
          failed++;
        } else {
          results[i] = { day, ok: true, count };
          fetched++;
        }
      } catch (ex) {
        if (ex instanceof ERedesAuthenticationError) throw ex;
        const msg = ex instanceof Error ? ex.message : String(ex);
        results[i] = { day, ok: false, count: 0, error: msg };
        failed++;
      }
    }
  }

  try {
    for (let w = 0; w < concurrency; w++) workers.push(worker());
    await Promise.all(workers);
  } catch (ex) {
    // Auth error mid-batch: abort remaining workers. Already-fetched days
    // persist via per-day upsert; surface partial results + rethrow.
    await Promise.allSettled(workers);
    throw ex;
  }

  return {
    requested,
    fetched,
    skipped,
    failed,
    results: results.filter(Boolean),
  };
}

export { ERedesError, buildDayQueue };
