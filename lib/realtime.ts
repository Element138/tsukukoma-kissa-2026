export const STATIC_REALTIME_CHANNELS = [
  "orders",
  "waiter",
  "menus",
  "categories",
  "actors",
  "assignments",
  "audit"
] as const;

export type StaticRealtimeChannel = (typeof STATIC_REALTIME_CHANNELS)[number];
export type RealtimeChannel = StaticRealtimeChannel | `kitchen:${string}`;
export type RealtimeEventType = "UPSERT" | "DELETE" | "BULK_INVALIDATE";

export type RealtimeEnvelope = {
  id: number;
  channel: string;
  eventType: RealtimeEventType;
  payload: Record<string, unknown>;
  createdAt: string;
};
