export const STATIC_REALTIME_CHANNELS = [
  "orders",
  "counter",
  "menus",
  "categories",
  "actors",
  "assignments",
  "audit",
  "settings"
] as const;

export type StaticRealtimeChannel = (typeof STATIC_REALTIME_CHANNELS)[number];
export type RealtimeChannel = StaticRealtimeChannel | `kitchen:${string}`;
export type RealtimeEventType = "UPSERT" | "DELETE" | "BULK_INVALIDATE";

export const OPS_STATIC_REALTIME_CHANNELS = ["orders", "counter", "menus"] as const;
const OPS_STATIC_CHANNEL_SET = new Set<string>(OPS_STATIC_REALTIME_CHANNELS);

export function isKitchenRealtimeChannel(channel: string): channel is `kitchen:${string}` {
  return channel.startsWith("kitchen:");
}

export function isOpsRealtimeChannel(channel: string) {
  return isKitchenRealtimeChannel(channel) || OPS_STATIC_CHANNEL_SET.has(channel);
}

export function partitionRealtimeChannels(channels: Iterable<string>) {
  const seen = new Set<string>();
  const ops: string[] = [];
  const sse: string[] = [];

  for (const raw of channels) {
    const channel = raw.trim();
    if (!channel || seen.has(channel)) {
      continue;
    }
    seen.add(channel);

    if (isOpsRealtimeChannel(channel)) {
      ops.push(channel);
    } else {
      sse.push(channel);
    }
  }

  return { ops, sse };
}

export type RealtimeEnvelope = {
  id: number;
  channel: string;
  eventType: RealtimeEventType;
  payload: Record<string, unknown>;
  createdAt: string;
};
