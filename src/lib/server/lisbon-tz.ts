const FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Lisbon",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export interface LisbonParts {
  dayOfWeek: number; // Mon=1 .. Sun=7
  minuteOfDay: number; // 0-1439
  localDate: string; // YYYY-MM-DD in Lisbon
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function lisbonParts(isoUtc: string): LisbonParts | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = FORMATTER.formatToParts(new Date(isoUtc));
  } catch {
    return null;
  }
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const dow = WEEKDAY_INDEX[map.weekday];
  if (dow === undefined) return null;
  const hour = Number.parseInt(map.hour, 10);
  const minute = Number.parseInt(map.minute, 10);
  if (hour === 24) {
    return null;
  }
  const year = Number.parseInt(map.year, 10);
  const month = Number.parseInt(map.month, 10);
  const day = Number.parseInt(map.day, 10);
  return {
    dayOfWeek: dow,
    minuteOfDay: hour * 60 + minute,
    localDate: `${map.year}-${map.month}-${map.day}`,
    year,
    month,
    day,
  };
}

export function mondayOfWeek(localDate: string): string {
  const d = new Date(`${localDate}T00:00:00Z`);
  const parts = lisbonParts(d.toISOString());
  const dow = parts?.dayOfWeek ?? 1;
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}
