// Aggregated curve computation: per-15-min-slot statistics over a set of days,
// grouped by day classification (workday / weekend). Conceptually in local time
// (Europe/Lisbon): slot 0 is always midnight local time, regardless of UTC offset.
// See CONTEXT.md — "Aggregated curve" and "Day classification".

export type ProfileReading = {
  readonly timestamp: string;
  readonly valueWh: number;
};

export type DayKind = "workday" | "weekend";

export type SlotStat = {
  /** 0–95, local midnight-anchored 15-minute slot. */
  readonly slot: number;
  /** Days that contributed a reading to this slot. */
  readonly n: number;
  readonly mean: number;
  /** Population standard deviation across contributing days. */
  readonly std: number;
  readonly min: number;
  readonly max: number;
  /** Individual per-day values (Wh) contributing to this slot. */
  readonly values: readonly number[];
};

export type DailyProfile = Readonly<Record<DayKind, readonly SlotStat[]>>;

export const SLOTS_PER_DAY = 96;

const DAY_KINDS: readonly DayKind[] = ["workday", "weekend"];

/**
 * Aggregate readings into per-slot statistics for workdays (Mon–Fri) and
 * weekends (Sat–Sun). Slots without data get n = 0 and zero-valued stats.
 */
export function computeDailyProfile(
  readings: readonly ProfileReading[],
  timeZone = "Europe/Lisbon",
): DailyProfile {
  const buckets: Record<DayKind, number[][]> = { workday: [], weekend: [] };

  const localParts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  for (const reading of readings) {
    const date = new Date(reading.timestamp);
    if (Number.isNaN(date.getTime())) continue;

    let hour = 0;
    let minute = 0;
    let weekday = "";
    for (const part of localParts.formatToParts(date)) {
      if (part.type === "hour") hour = Number(part.value);
      else if (part.type === "minute") minute = Number(part.value);
      else if (part.type === "weekday") weekday = part.value;
    }

    const slot = hour * 4 + Math.floor(minute / 15);
    const kind: DayKind = weekday === "Sat" || weekday === "Sun" ? "weekend" : "workday";
    (buckets[kind][slot] ??= []).push(reading.valueWh);
  }

  return {
    workday: slotsFrom(buckets.workday),
    weekend: slotsFrom(buckets.weekend),
  };
}

function slotsFrom(bucket: ReadonlyArray<number[] | undefined>): SlotStat[] {
  return Array.from({ length: SLOTS_PER_DAY }, (_, slot) => summarize(slot, bucket[slot] ?? []));
}

function summarize(slot: number, values: number[]): SlotStat {
  const n = values.length;
  if (n === 0) return { slot, n, mean: 0, std: 0, min: 0, max: 0, values: [] };

  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  return {
    slot,
    n,
    mean,
    std: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
    values,
  };
}

/** Largest mean + 2 std across both day kinds — a shared y-domain covering
 *  the outer band (per-day outliers no longer plotted). */
export function profileMax(profile: DailyProfile): number {
  let max = 0;
  for (const kind of DAY_KINDS) {
    for (const stat of profile[kind]) {
      max = Math.max(max, stat.mean + 2 * stat.std);
    }
  }
  return max;
}

/** Round a value up to a 2-significant-figure ceiling (e.g. 1068 → 1100). */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const pow = 10 ** Math.max(exp - 1, 0);
  return Math.ceil(value / pow) * pow;
}
