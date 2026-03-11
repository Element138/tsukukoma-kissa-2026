"use client";

import { useEffect, useMemo, useRef } from "react";
import type { RealtimeEnvelope } from "@/lib/realtime";

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

  const channelKey = useMemo(() => [...channels].sort().join(","), [channels]);

  useEffect(() => {
    if (!enabled || !channelKey) {
      return;
    }

    let source: EventSource | null = null;
    let closed = false;
    let openedOnce = false;

    const open = () => {
      const params = new URLSearchParams();
      params.set("channels", channelKey);
      const cursor = cursorByChannelKey.get(channelKey);
      if (cursor && cursor > 0) {
        params.set("cursor", String(cursor));
      }

      source = new EventSource(`/api/realtime/events?${params.toString()}`);

      source.onopen = () => {
        if (openedOnce) {
          onResyncRef.current?.("reconnect");
        }
        openedOnce = true;
      };

      source.addEventListener("realtime", (ev) => {
        try {
          const payload = JSON.parse((ev as MessageEvent<string>).data) as RealtimeEnvelope;
          if (typeof payload.id === "number" && payload.id > 0) {
            cursorByChannelKey.set(channelKey, payload.id);
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

    const onFocus = () => {
      onResyncRef.current?.("focus");
    };

    const fallbackTimer = window.setInterval(() => {
      onResyncRef.current?.("interval");
    }, fallbackIntervalMs);

    window.addEventListener("focus", onFocus);
    open();

    return () => {
      closed = true;
      window.clearInterval(fallbackTimer);
      window.removeEventListener("focus", onFocus);
      source?.close();
      source = null;
    };
  }, [channelKey, enabled, fallbackIntervalMs]);
}
