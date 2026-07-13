"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { LoadingScreen } from "@/components/loading-screen";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { useSession } from "@/components/use-session";
import { useToast } from "@/components/toast";

type DisplayOrder = {
  id: string;
  orderNo: number;
  createdAt: string;
  confirmedAt: string | null;
  itemCount: number;
  readyItemCount: number;
  queuedItemCount: number;
};

type OrderDisplayPayload = {
  readyOrders: DisplayOrder[];
  unreadyOrders: DisplayOrder[];
};

type Callout = {
  key: number;
  orderNo: number;
  createdAt: string;
  followsPrevious: boolean;
  exiting?: boolean;
};

type QueuedCall = {
  id: string;
  orderNo: number;
  createdAt: string;
  followsPrevious: boolean;
};

const ORDER_AGE_LONG_WAIT_MS = 20 * 60 * 1000;
const CALLOUT_FADE_OUT_MS = 450;
const CALL_BURST_WINDOW_MS = 5000;
const CALL_ASSETS = {
  bell: "/audio/order-call/notification.wav",
  waitNormal: "/audio/order-call/wait-normal.mp3",
  waitLong: "/audio/order-call/wait-long.mp3",
  continued: "/audio/order-call/continued.mp3",
  counter: "/audio/order-call/counter.mp3",
};

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function playAudio(src: string) {
  return new Promise<void>((resolve) => {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    void audio.play().catch(() => resolve());
  });
}

function orderNumberAudioSrc(orderNo: number, part: "number" | "customer") {
  return `/api/order-display/audio/${part}/${encodeURIComponent(String(orderNo))}`;
}

async function playOrderCallAudio(call: Callout) {
  const isLongWait =
    Date.now() - new Date(call.createdAt).getTime() >= ORDER_AGE_LONG_WAIT_MS;
  const parts = [
    CALL_ASSETS.bell,
    call.followsPrevious
      ? CALL_ASSETS.continued
      : isLongWait
        ? CALL_ASSETS.waitLong
        : CALL_ASSETS.waitNormal,
    orderNumberAudioSrc(call.orderNo, "number"),
    orderNumberAudioSrc(call.orderNo, "customer"),
    call.followsPrevious && isLongWait ? CALL_ASSETS.waitLong : null,
    CALL_ASSETS.counter,
  ].filter(Boolean) as string[];

  for (const src of parts) {
    await playAudio(src);
  }
}

function tileTone(order: DisplayOrder) {
  if (order.queuedItemCount >= 4) {
    return "dense";
  }
  if (order.itemCount >= 3) {
    return "warm";
  }
  return "calm";
}

function orderNumberStyle(orderNo: number) {
  const digitCount = String(orderNo).length;
  const scale = Math.min(1, 2.55 / Math.max(1, digitCount));
  return {
    "--order-no-scale": String(scale),
    "--order-no-fit-size": `${145 / Math.max(1, digitCount)}cqw`,
  } as CSSProperties;
}

export default function OrderDisplayPage() {
  const { loading, session } = useSession(["ORDER_DISPLAY"]);
  const { notify } = useToast();
  const [readyOrders, setReadyOrders] = useState<DisplayOrder[]>([]);
  const [unreadyOrders, setUnreadyOrders] = useState<DisplayOrder[]>([]);
  const [callout, setCallout] = useState<Callout | null>(null);
  const reloadInFlightRef = useRef(false);
  const queuedReloadRef = useRef(false);
  const didBootstrapRef = useRef(false);
  const previousReadyIdsRef = useRef<Set<string>>(new Set());
  const previousUnreadyIdsRef = useRef<Set<string>>(new Set());
  const callQueueRef = useRef<QueuedCall[]>([]);
  const callInFlightRef = useRef(false);
  const lastCallEndedAtRef = useRef(0);

  const processCallQueue = async () => {
    if (callInFlightRef.current) {
      return;
    }

    const nextCall = callQueueRef.current.shift();
    if (!nextCall) {
      return;
    }

    callInFlightRef.current = true;
    const activeCall: Callout = {
      key: Date.now(),
      orderNo: nextCall.orderNo,
      createdAt: nextCall.createdAt,
      followsPrevious: nextCall.followsPrevious,
    };
    setCallout(activeCall);

    await playOrderCallAudio(activeCall);
    setCallout((current) =>
      current?.key === activeCall.key ? { ...current, exiting: true } : current,
    );
    await wait(CALLOUT_FADE_OUT_MS);
    setCallout((current) =>
      current?.key === activeCall.key ? null : current,
    );
    lastCallEndedAtRef.current = Date.now();
    callInFlightRef.current = false;

    if (callQueueRef.current.length > 0) {
      void processCallQueue();
    }
  };

  const enqueueCalls = (orders: DisplayOrder[]) => {
    const now = Date.now();
    for (const order of orders.sort((a, b) => a.orderNo - b.orderNo)) {
      const followsPrevious =
        callInFlightRef.current ||
        callQueueRef.current.length > 0 ||
        (lastCallEndedAtRef.current > 0 &&
          now - lastCallEndedAtRef.current <= CALL_BURST_WINDOW_MS);
      callQueueRef.current.push({
        id: order.id,
        orderNo: order.orderNo,
        createdAt: order.createdAt,
        followsPrevious,
      });
    }
    void processCallQueue();
  };

  const applyPayload = (payload: OrderDisplayPayload) => {
    const nextReadyIds = new Set(payload.readyOrders.map((order) => order.id));
    const nextUnreadyIds = new Set(
      payload.unreadyOrders.map((order) => order.id),
    );
    const previousReadyIds = previousReadyIdsRef.current;
    const previousUnreadyIds = previousUnreadyIdsRef.current;

    if (didBootstrapRef.current) {
      const newlyReady = payload.readyOrders.filter(
        (order) =>
          !previousReadyIds.has(order.id) && previousUnreadyIds.has(order.id),
      );

      if (newlyReady.length > 0) {
        enqueueCalls(newlyReady);
      }
    }

    didBootstrapRef.current = true;
    previousReadyIdsRef.current = nextReadyIds;
    previousUnreadyIdsRef.current = nextUnreadyIds;
    setReadyOrders(payload.readyOrders);
    setUnreadyOrders(payload.unreadyOrders);
  };

  const reload = async () => {
    if (reloadInFlightRef.current) {
      queuedReloadRef.current = true;
      return;
    }
    reloadInFlightRef.current = true;

    try {
      const payload =
        await apiFetch<OrderDisplayPayload>("/api/order-display");
      applyPayload(payload);
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "注文表示の更新に失敗しました",
      });
    } finally {
      reloadInFlightRef.current = false;
      if (queuedReloadRef.current) {
        queuedReloadRef.current = false;
        void reload();
      }
    }
  };

  useEffect(() => {
    if (!session) {
      return;
    }
    void reload();
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }
    const timer = setInterval(() => {
      void reload();
    }, 15_000);
    return () => clearInterval(timer);
  }, [session]);

  useRealtimeSubscription({
    enabled: Boolean(session),
    channels: ["orders"],
    onEvent: () => {
      void reload();
    },
    onResync: () => {
      void reload();
    },
  });

  const hasReady = readyOrders.length > 0;
  const hasUnready = unreadyOrders.length > 0;
  const hasOrders = hasReady || hasUnready;
  const readyMode = readyOrders.length <= 4 ? "featured" : "tiled";
  const orderedReady = useMemo(
    () => [...readyOrders].sort((a, b) => a.orderNo - b.orderNo),
    [readyOrders],
  );
  const orderedUnready = useMemo(
    () => [...unreadyOrders].sort((a, b) => a.orderNo - b.orderNo),
    [unreadyOrders],
  );
  if (loading || !session) {
    return <LoadingScreen />;
  }

  return (
    <main
      className={[
        "order-display-screen",
        hasOrders ? "has-orders" : "no-orders",
        hasReady ? "has-ready" : "no-ready",
        hasUnready ? "has-unready" : "no-unready",
      ].join(" ")}
    >
      <div className="order-display-empty">注文はありません</div>

      <div
        className="order-display-panels"
        style={
          {
            "--ready-count": String(Math.max(1, readyOrders.length)),
            "--unready-count": String(Math.max(1, unreadyOrders.length)),
          } as CSSProperties
        }
      >
        <section className="order-display-panel order-display-panel-unready">
          <header className="order-display-panel-header">
            <span>調理中です</span>
          </header>
          {hasUnready ? (
            <div
              className="order-display-tile-grid order-display-unready-grid"
            >
              {orderedUnready.map((order) => (
                <article
                  key={order.id}
                  className={`order-display-unready-tile ${tileTone(order)}`}
                >
                  <strong style={orderNumberStyle(order.orderNo)}>
                    {order.orderNo}
                  </strong>
                </article>
              ))}
            </div>
          ) : (
            <div className="order-display-panel-empty">
              調理中の注文はありません
            </div>
          )}
        </section>

        <section className="order-display-panel order-display-panel-ready">
          <header className="order-display-panel-header">
            <span>カウンターにお越しください</span>
          </header>
          <div
            className={`order-display-ready-grid order-display-ready-grid-${readyMode}`}
          >
            {orderedReady.map((order) => (
              <article key={order.id} className="order-display-ready-tile">
                <strong style={orderNumberStyle(order.orderNo)}>
                  {order.orderNo}
                </strong>
              </article>
            ))}
          </div>
        </section>
      </div>

      {callout && (
        <div
          key={callout.key}
          className={[
            "order-display-callout",
            callout.exiting ? "is-exiting" : "",
          ].join(" ")}
        >
          <span>カウンターにお越しください</span>
          <strong style={orderNumberStyle(callout.orderNo)}>
            {callout.orderNo}
          </strong>
        </div>
      )}
    </main>
  );
}
