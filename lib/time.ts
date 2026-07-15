const TOKYO_TZ = "Asia/Tokyo";
const TOKYO_OFFSET_MINUTES = 9 * 60;
const TOKYO_DAY_MS = 24 * 60 * 60 * 1000;

export function now(): Date {
  return new Date();
}

function tokyoDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  return { year, month, day };
}

export function tokyoDateKey(date = now()): string {
  const { year, month, day } = tokyoDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function tokyoDayRangeUtc(date = now()) {
  const { year, month, day } = tokyoDateParts(date);
  const startMs = Date.UTC(year, month - 1, day, 0, 0, 0) - TOKYO_OFFSET_MINUTES * 60_000;
  return {
    dateKey: tokyoDateKey(date),
    start: new Date(startMs),
    end: new Date(startMs + TOKYO_DAY_MS),
  };
}

export function tokyoDayRangeUtcFromDateKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    throw new Error(`Invalid Tokyo date key: ${dateKey}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const startMs = Date.UTC(year, month - 1, day, 0, 0, 0) - TOKYO_OFFSET_MINUTES * 60_000;
  return {
    dateKey,
    start: new Date(startMs),
    end: new Date(startMs + TOKYO_DAY_MS),
  };
}

export function addDaysToTokyoDateKey(dateKey: string, days: number) {
  const { start } = tokyoDayRangeUtcFromDateKey(dateKey);
  return tokyoDateKey(new Date(start.getTime() + days * TOKYO_DAY_MS));
}

export function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

export function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1_000);
}

export function formatTokyo(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

export function elapsedMss(from: Date, to = new Date()): string {
  const sec = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1_000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}


