"use client";

import { useEffect, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  partitionRealtimeChannels,
  type RealtimeEnvelope,
  type RealtimeEventType
} from "@/lib/realtime";

type ResyncReason = "reconnect" | "focus" | "interval";

type UseRealtimeSubscriptionOptions = {
  channels: string[];
  enabled?: boolean;
  onEvent: (event: RealtimeEnvelope) => void;
  onResync?: (reason: ResyncReason) => void;
  fallbackIntervalMs?: number;
};

const DEFAULT_FALLBACK_INTERVAL_MS = 120_000;
const cursorByChannelKey = new Map<string, number>();
const lagSamplesByChannelKey = new Map<string, number[]>();
const lagSampleCountByChannelKey = new Map<string, number>();
let warnedMissingSupabaseEnv = false;

type RealtimeTokenResponse = {
  ok: boolean;
  data?: {
    token: string | null;
    channels: string[];
    expiresAt: string | null;
  };
};

function normalizeChannels(channels: string[]) {
  return [...new Set(channels.map((channel) => channel.trim()).filter(Boolean))].sort();
}

function topicSafeKey(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function normalizeEventType(raw: unknown): RealtimeEventType {
  if (raw === "UPSERT" || raw === "DELETE" || raw === "BULK_INVALIDATE") {
    return raw;
  }
  return "BULK_INVALIDATE";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function computeP95(samples: number[]) {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return Math.round(sorted[index]);
}

function recordOpsDeliveryLag(channelKey: string, createdAt: string) {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return;
  }

  const lagMs = Math.max(0, Date.now() - createdAtMs);
  const samples = lagSamplesByChannelKey.get(channelKey) ?? [];
  samples.push(lagMs);
  if (samples.length > 250) {
    samples.shift();
  }
  lagSamplesByChannelKey.set(channelKey, samples);

  const nextCount = (lagSampleCountByChannelKey.get(channelKey) ?? 0) + 1;
  lagSampleCountByChannelKey.set(channelKey, nextCount);
  if (nextCount % 20 !== 0) {
    return;
  }

  const p95 = computeP95(samples);
  const message = `[realtime] ops delivery p95=${p95}ms channels=${channelKey} samples=${samples.length}`;
  if (p95 > 1000) {
    console.warn(message);
  } else {
    console.info(message);
  }
}

export function useRealtimeSubscription(options: UseRealtimeSubscriptionOptions) {
  const {
    channels,
    enabled = true,
    onEvent,
    onResync,
    fallbackIntervalMs = DEFAULT_FALLBACK_INTERVAL_MS
  } = options;

  const onEventRef = useRef(onEvent);
  const onResyncRef = useRef(onResync);

  onEventRef.current = onEvent;
  onResyncRef.current = onResync;

  const normalizedChannels = useMemo(() => normalizeChannels(channels), [channels]);
  const { ops: opsChannels } = useMemo(
    () => partitionRealtimeChannels(normalizedChannels),
    [normalizedChannels]
  );
  const channelKey = useMemo(() => normalizedChannels.join(","), [normalizedChannels]);
  const opsChannelKey = useMemo(() => opsChannels.join(","), [opsChannels]);
  const sseChannelKey = channelKey;

  useEffect(() => {
    if (!enabled || !channelKey) {
      return;
    }

    let source: EventSource | null = null;
    let supabase = null as ReturnType<typeof createClient> | null;
    let realtimeChannel = null as ReturnType<ReturnType<typeof createClient>["channel"]> | null;
    let closed = false;
    let sseOpenedOnce = false;
    let supabaseOpenedOnce = false;

    const openSse = () => {
      if (!sseChannelKey) {
        return;
      }

      const params = new URLSearchParams();
      params.set("channels", sseChannelKey);
      const cursor = cursorByChannelKey.get(sseChannelKey);
      if (cursor && cursor > 0) {
        params.set("cursor", String(cursor));
      }

      source = new EventSource(`/api/realtime/events?${params.toString()}`);

      source.onopen = () => {
        if (sseOpenedOnce) {
          onResyncRef.current?.("reconnect");
        }
        sseOpenedOnce = true;
      };

      source.addEventListener("realtime", (ev) => {
        try {
          const payload = JSON.parse((ev as MessageEvent<string>).data) as RealtimeEnvelope;
          if (typeof payload.id === "number" && payload.id > 0) {
            cursorByChannelKey.set(sseChannelKey, payload.id);
          }
          onEventRef.current(payload);
        } catch (error) {
          console.error("failed to parse realtime event", error);
        }
      });

      source.addEventListener("close", () => {
        if (!closed) {
          source?.close();
          source = null;
        }
      });

      source.onerror = () => {
        // Native EventSource reconnect is enabled; we keep this for observability.
      };
    };

    const openSupabase = async () => {
      if (!opsChannelKey) {
        return;
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) {
        if (!warnedMissingSupabaseEnv) {
          console.warn("supabase env not configured; ops realtime disabled");
          warnedMissingSupabaseEnv = true;
        }
        return;
      }

      try {
        const params = new URLSearchParams();
        params.set("channels", opsChannelKey);
        const tokenRes = await fetch(`/api/realtime/token?${params.toString()}`, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store"
        });

        if (!tokenRes.ok) {
          console.error("failed to fetch realtime token", tokenRes.status);
          return;
        }

        const body = (await tokenRes.json()) as RealtimeTokenResponse;
        const token = body.data?.token ?? null;
        const authorizedChannels = normalizeChannels(body.data?.channels ?? []);
        if (!token || authorizedChannels.length === 0 || closed) {
          return;
        }

        supabase = createClient(supabaseUrl, supabaseAnonKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
          }
        });
        supabase.realtime.setAuth(token);
        const topicKey = topicSafeKey(opsChannelKey);
        realtimeChannel = supabase.channel(`kissa-realtime-${topicKey}-${Date.now()}`);

        for (const channel of authorizedChannels) {
          realtimeChannel = realtimeChannel.on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "RealtimeEvent",
              filter: `channel=eq.${channel}`
            },
            (payload) => {
              const next = payload.new as {
                id: number;
                channel: string;
                eventType: string;
                payload: unknown;
                createdAt: string;
              };

              const envelope: RealtimeEnvelope = {
                id: typeof next.id === "number" ? next.id : 0,
                channel: typeof next.channel === "string" ? next.channel : "",
                eventType: normalizeEventType(next.eventType),
                payload: asRecord(next.payload),
                createdAt:
                  typeof next.createdAt === "string"
                    ? next.createdAt
                    : new Date().toISOString()
              };

              recordOpsDeliveryLag(opsChannelKey, envelope.createdAt);
              onEventRef.current(envelope);
            }
          );
        }

        realtimeChannel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            if (supabaseOpenedOnce) {
              onResyncRef.current?.("reconnect");
            }
            supabaseOpenedOnce = true;
            return;
          }

          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn("supabase realtime channel issue", status);
          }
        });
      } catch (error) {
        console.error("supabase realtime setup failed", error);
      }
    };

    const onFocus = () => {
      onResyncRef.current?.("focus");
    };

    const fallbackTimer = window.setInterval(() => {
      onResyncRef.current?.("interval");
    }, fallbackIntervalMs);

    window.addEventListener("focus", onFocus);
    openSse();
    void openSupabase();

    return () => {
      closed = true;
      window.clearInterval(fallbackTimer);
      window.removeEventListener("focus", onFocus);
      source?.close();
      source = null;
      if (supabase && realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
      }
      supabase = null;
      realtimeChannel = null;
    };
  }, [channelKey, enabled, fallbackIntervalMs, opsChannelKey, sseChannelKey]);
}
