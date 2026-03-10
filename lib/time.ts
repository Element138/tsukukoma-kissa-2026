const TOKYO_TZ = "Asia/Tokyo";

export function now(): Date {
  return new Date();
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


