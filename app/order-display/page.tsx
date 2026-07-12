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
};

const CALLOUT_MS = 3200;

function playCallTone() {
  try {
    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    const audio = new AudioContextCtor();
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.connect(audio.destination);

    const notes = [659.25, 880, 987.77];
    notes.forEach((frequency, index) => {
      const start = audio.currentTime + index * 0.18;
      const oscillator = audio.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.connect(gain);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      oscillator.start(start);
      oscillator.stop(start + 0.26);
    });

    window.setTimeout(() => void audio.close(), 1200);
  } catch {
    // Browsers may block audio until the display has had a user gesture.
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

  const applyPayload = (payload: OrderDisplayPayload) => {
    const nextReadyIds = new Set(payload.readyOrders.map((order) => order.id));
    const nextUnreadyIds = new Set(
      payload.unreadyOrders.map((order) => order.id),
    );
    const previousReadyIds = previousReadyIdsRef.current;
    const previousUnreadyIds = previousUnreadyIdsRef.current;

    if (didBootstrapRef.current) {
      const newlyReady = payload.readyOrders.find(
        (order) =>
          !previousReadyIds.has(order.id) && previousUnreadyIds.has(order.id),
      );

      if (newlyReady) {
        setCallout({ key: Date.now(), orderNo: newlyReady.orderNo });
        playCallTone();
        window.setTimeout(() => {
          setCallout((current) =>
            current?.orderNo === newlyReady.orderNo ? null : current,
          );
        }, CALLOUT_MS);
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
            <div className="order-display-tile-grid order-display-unready-grid">
              {orderedUnready.map((order) => (
                <article
                  key={order.id}
                  className={`order-display-unready-tile ${tileTone(order)}`}
                >
                  <span className="order-display-tile-label">注文番号</span>
                  <strong>{order.orderNo}</strong>
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
                <span>注文番号</span>
                <strong>{order.orderNo}</strong>
              </article>
            ))}
          </div>
        </section>
      </div>

      {callout && (
        <div key={callout.key} className="order-display-callout">
          <span>カウンターにお越しください</span>
          <strong>{callout.orderNo}</strong>
        </div>
      )}
    </main>
  );
}
