import { tokyoDateKey } from "@/lib/time";

export type MenuLastOrder = { date: string; closesAt: string };

export function parseMenuLastOrder(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const at = new Date(`${date}T${time}:00+09:00`);
  return Number.isFinite(at.getTime()) && tokyoDateKey(at) === date ? at : null;
}

export function menuLastOrderTime(at: Date) {
  return new Date(at.getTime() + 9 * 60 * 60_000).toISOString().slice(11, 16);
}

export function menuDisplayClosed(entries: MenuLastOrder[], at: Date) {
  const today = tokyoDateKey(at);
  const entry = entries.find(value => value.date === today);
  return Boolean(entry && Number.isFinite(Date.parse(entry.closesAt)) && at.getTime() >= Date.parse(entry.closesAt));
}
