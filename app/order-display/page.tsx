"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { LoadingScreen } from "@/components/loading-screen";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { useSession } from "@/components/use-session";
import { useWakeLock } from "@/components/use-wake-lock";
import { useToast } from "@/components/toast";
import { ORDER_AGE_MINUTES } from "@/lib/order-age";

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
  callCursor: number;
  calls: Array<Pick<DisplayOrder, "id" | "orderNo" | "createdAt"> & { callCount: number }>;
  readyOrders: DisplayOrder[];
  unreadyOrders: DisplayOrder[];
};

type OrderDisplaySettings = {
  orderDisplayMarqueeText: string;
  orderDisplayMarqueeSpeedSeconds: number;
  orderCallVolume: number;
};

type Callout = {
  key: number;
  orderNo: number;
  createdAt: string;
  followsPrevious: boolean;
  callCount: number;
  exiting?: boolean;
};

type QueuedCall = {
  id: string;
  orderNo: number;
  createdAt: string;
  followsPrevious: boolean;
  callCount: number;
};

const ORDER_AGE_LONG_WAIT_MS = ORDER_AGE_MINUTES[1] * 60 * 1000;
const ORDER_AGE_EXTREME_LONG_WAIT_MS = ORDER_AGE_MINUTES[2] * 60 * 1000;
const CALLOUT_MIN_VISIBLE_MS = 5200;
const CALLOUT_FADE_OUT_MS = 450;
const CALL_BURST_WINDOW_MS = 5000;
const UNREADY_SCROLL_DURATION_MS = 36_000;
const READY_SCROLL_DURATION_MS = 14_000;
const ORDER_DISPLAY_REFRESH_MS = 5_000;
const CALL_MELODY_VOLUME_SCALE = 0.95;
const CALL_ASSETS = {
  melody: "/audio/order-call/call-melody-song-20260714.wav",
  waitLong: "/audio/order-call/wait-long.mp3",
  waitExtremeLongApology: "/audio/order-call/extreme-long-wait-apology.mp3",
  repeatedCallApology: "/audio/order-call/repeated-call-apology.mp3",
  continued: "/audio/order-call/continued.mp3",
  preparedCounter: "/audio/order-call/prepared-counter.mp3",
  counter: "/audio/order-call/counter.mp3",
};

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => { window.clearTimeout(timer); signal?.removeEventListener("abort",finish); resolve(); };
    const timer = window.setTimeout(finish,ms);
    if (signal?.aborted) finish(); else signal?.addEventListener("abort",finish,{once:true});
  });
}

function playAudioElement(audio: HTMLAudioElement, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => { audio.pause(); audio.onended=null; audio.onerror=null; signal?.removeEventListener("abort",finish); resolve(); };
    if (signal?.aborted) { finish(); return; }
    audio.currentTime = 0;
    audio.onended = finish;
    audio.onerror = finish;
    signal?.addEventListener("abort",finish,{once:true});
    void audio.play().catch(finish);
  });
}

function waitForAudioReady(audio: HTMLAudioElement, signal?: AbortSignal) {
  if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      audio.removeEventListener("canplaythrough", onReady);
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("error", onReady);
      signal?.removeEventListener("abort",onReady); window.clearTimeout(timeout);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    audio.addEventListener("canplaythrough", onReady, { once: true });
    audio.addEventListener("canplay", onReady, { once: true });
    audio.addEventListener("error", onReady, { once: true });
    const timeout = window.setTimeout(onReady,15000);
    if (signal?.aborted) onReady(); else signal?.addEventListener("abort",onReady,{once:true});
  });
}

function preloadAudio(src: string, volume = 1) {
  const audio = new Audio(src);
  audio.preload = "auto";
  audio.volume = Math.max(0, Math.min(1, volume));
  audio.load();
  return audio;
}

function orderNumberAudioSrc(orderNo: number, part: "number" | "customer") {
  if (Number.isInteger(orderNo) && orderNo >= 1 && orderNo <= 2000) {
    return `/audio/order-call/numbers/v2/${part}-${orderNo}.mp3`;
  }
  return `/api/order-display/audio/${part}/${encodeURIComponent(String(orderNo))}`;
}

function warmOrderNumberAudio(orderNo: number) {
  for (const part of ["number", "customer"] as const) {
    void fetch(orderNumberAudioSrc(orderNo, part), {
      credentials: "include",
      cache: "force-cache",
    }).catch(() => {});
  }
}

async function playOrderCallAudio(call: Callout, melodyVolume: number, signal?: AbortSignal) {
  const orderAgeMs = Date.now() - new Date(call.createdAt).getTime();
  const isLongWait = orderAgeMs >= ORDER_AGE_LONG_WAIT_MS;
  const isExtremeLongWait = orderAgeMs >= ORDER_AGE_EXTREME_LONG_WAIT_MS;
  const shouldPlayRepeatedCallApology =
    call.callCount >= 3 && !call.followsPrevious;
  const numberAudio = preloadAudio(orderNumberAudioSrc(call.orderNo, "number"));
  const customerAudio = preloadAudio(
    orderNumberAudioSrc(call.orderNo, "customer"),
  );
  const orderNumberAudioReady = Promise.all([
    waitForAudioReady(numberAudio,signal),
    waitForAudioReady(customerAudio,signal),
  ]);

  const introParts = [
    call.followsPrevious
      ? preloadAudio(CALL_ASSETS.continued)
      : preloadAudio(
          CALL_ASSETS.melody,
          melodyVolume * CALL_MELODY_VOLUME_SCALE,
        ),
    shouldPlayRepeatedCallApology
      ? preloadAudio(CALL_ASSETS.repeatedCallApology)
      : null,
    isExtremeLongWait && !call.followsPrevious && !shouldPlayRepeatedCallApology
      ? preloadAudio(CALL_ASSETS.waitExtremeLongApology)
      : null,
    isLongWait &&
    !isExtremeLongWait &&
    !call.followsPrevious &&
    !shouldPlayRepeatedCallApology
      ? preloadAudio(CALL_ASSETS.waitLong)
      : null,
  ].filter(Boolean) as Array<string | HTMLAudioElement>;

  for (const part of introParts) {
    if (signal?.aborted) return;
    await playAudioElement(
      typeof part === "string" ? preloadAudio(part) : part,
      signal,
    );
  }

  await orderNumberAudioReady;

  const parts = [
    numberAudio,
    customerAudio,
    call.followsPrevious ? CALL_ASSETS.counter : CALL_ASSETS.preparedCounter,
    call.followsPrevious && isExtremeLongWait
      ? CALL_ASSETS.waitExtremeLongApology
      : null,
  ].filter(Boolean) as Array<string | HTMLAudioElement>;

  for (const part of parts) {
    if (signal?.aborted) return;
    await playAudioElement(
      typeof part === "string" ? preloadAudio(part) : part,
      signal,
    );
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
  const scale = Math.min(1, 2.9 / Math.max(1, digitCount));
  return {
    "--order-no-scale": String(scale),
    "--order-no-fit-size": `${160 / Math.max(1, digitCount)}cqw`,
  } as CSSProperties;
}

export default function OrderDisplayPage() {
  const { loading, session } = useSession(["ORDER_DISPLAY"]);
  const { notify } = useToast();
  useWakeLock(Boolean(session));
  const [readyOrders, setReadyOrders] = useState<DisplayOrder[]>([]);
  const [unreadyOrders, setUnreadyOrders] = useState<DisplayOrder[]>([]);
  const [settings, setSettings] = useState<OrderDisplaySettings>({
    orderDisplayMarqueeText: "",
    orderDisplayMarqueeSpeedSeconds: 24,
    orderCallVolume: 0.8,
  });
  const [showUnreadyBird, setShowUnreadyBird] = useState(false);
  const [callout, setCallout] = useState<Callout | null>(null);
  const unreadyViewportRef = useRef<HTMLDivElement | null>(null);
  const unreadyTrackRef = useRef<HTMLDivElement | null>(null);
  const readyViewportRef = useRef<HTMLDivElement | null>(null);
  const readyTrackRef = useRef<HTMLDivElement | null>(null);
  const unreadyAnimationsRef = useRef<Animation[]>([]);
  const readyAnimationsRef = useRef<Animation[]>([]);
  const reloadInFlightRef = useRef(false);
  const queuedReloadRef = useRef(false);
  const callCursorRef = useRef<number | null>(null);
  const callQueueRef = useRef<QueuedCall[]>([]);
  const callInFlightRef = useRef(false);
  const lastCallEndedAtRef = useRef(0);
  const activeCallRef = useRef<{orderId:string;controller:AbortController}|null>(null);
  useEffect(()=>()=>{activeCallRef.current?.controller.abort();callQueueRef.current=[];},[]);

  const processCallQueue = async () => {
    if (callInFlightRef.current) {
      return;
    }

    const nextCall = callQueueRef.current.shift();
    if (!nextCall) {
      return;
    }

    callInFlightRef.current = true;
    const controller = new AbortController();
    activeCallRef.current = {orderId:nextCall.id,controller};
    const activeCall: Callout = {
      key: Date.now(),
      orderNo: nextCall.orderNo,
      createdAt: nextCall.createdAt,
      followsPrevious: nextCall.followsPrevious,
      callCount: nextCall.callCount,
    };
    setCallout(activeCall);

    const visibleStartedAt = Date.now();
    await playOrderCallAudio(activeCall, settings.orderCallVolume,controller.signal);
    await wait(Math.max(0, CALLOUT_MIN_VISIBLE_MS - (Date.now() - visibleStartedAt)),controller.signal);
    setCallout((current) =>
      current?.key === activeCall.key ? { ...current, exiting: true } : current,
    );
    await wait(CALLOUT_FADE_OUT_MS,controller.signal);
    setCallout((current) =>
      current?.key === activeCall.key ? null : current,
    );
    lastCallEndedAtRef.current = Date.now();
    callInFlightRef.current = false;
    if (activeCallRef.current?.controller === controller) activeCallRef.current=null;

    if (callQueueRef.current.length > 0) {
      void processCallQueue();
    }
  };

  const enqueueCalls = (orders: OrderDisplayPayload["calls"]) => {
    const now = Date.now();
    for (const order of orders) {
      warmOrderNumberAudio(order.orderNo);
      const callCount = order.callCount;
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
        callCount,
      });
    }
    void processCallQueue();
  };

  const applyPayload = (payload: OrderDisplayPayload) => {
    const calledIds = new Set(payload.readyOrders.map(order=>order.id));
    callQueueRef.current = callQueueRef.current.filter(call=>calledIds.has(call.id));
    if (activeCallRef.current && !calledIds.has(activeCallRef.current.orderId)) {
      activeCallRef.current.controller.abort(); setCallout(null);
    }
    if (payload.calls.length > 0) enqueueCalls(payload.calls.filter(call=>calledIds.has(call.id)));
    callCursorRef.current = payload.callCursor;
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
        await apiFetch<OrderDisplayPayload>(callCursorRef.current == null ? "/api/order-display" : `/api/order-display?afterCallId=${callCursorRef.current}`);
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

  const reloadSettings = async () => {
    try {
      const data = await apiFetch<{ settings: OrderDisplaySettings }>(
        "/api/admin/menu-display-settings",
      );
      setSettings(data.settings);
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "注文表示設定の更新に失敗しました",
      });
    }
  };

  useEffect(() => {
    if (!session) {
      return;
    }
    void reload();
    void reloadSettings();
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }
    const timer = setInterval(() => {
      void reload();
    }, ORDER_DISPLAY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [session]);

  useRealtimeSubscription({
    enabled: Boolean(session),
    channels: ["orders", "settings"],
    onEvent: (event) => {
      if (event.channel === "settings") {
        void reloadSettings();
        return;
      }
      void reload();
    },
    onResync: () => {
      void reload();
      void reloadSettings();
    },
    fallbackIntervalMs: ORDER_DISPLAY_REFRESH_MS,
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
  const readyColumns = Math.min(3, Math.max(1, readyOrders.length));
  const marqueeText = settings.orderDisplayMarqueeText.trim();
  const readyLayoutSignature = orderedReady
    .map((order) => `${order.id}:${order.orderNo}`)
    .join("|");
  const unreadyLayoutSignature = orderedUnready
    .map(
      (order) =>
        `${order.id}:${order.orderNo}:${order.itemCount}:${order.queuedItemCount}`,
    )
    .join("|");

  useEffect(() => {
    for (const animation of unreadyAnimationsRef.current) {
      animation.cancel();
    }
    unreadyAnimationsRef.current = [];

    const viewport = unreadyViewportRef.current;
    const track = unreadyTrackRef.current;
    if (!viewport || !track || orderedUnready.length === 0) {
      setShowUnreadyBird(false);
      return;
    }

    let raf = 0;
    const updateLayout = () => {
      for (const animation of unreadyAnimationsRef.current) {
        animation.cancel();
      }
      unreadyAnimationsRef.current = [];
      track.style.transform = "translateY(0px)";

      const viewportStyle = window.getComputedStyle(viewport);
      const viewportPaddingY =
        (Number.parseFloat(viewportStyle.paddingTop) || 0) +
        (Number.parseFloat(viewportStyle.paddingBottom) || 0);
      const visibleHeight = Math.max(
        0,
        viewport.clientHeight - viewportPaddingY,
      );
      const overflowPx = Math.max(0, track.scrollHeight - visibleHeight + 2);
      const spareHeight = Math.max(0, visibleHeight - track.scrollHeight);
      const canShowBird =
        overflowPx <= 1 &&
        spareHeight >= visibleHeight * 0.34 &&
        viewport.clientWidth >= 340;
      setShowUnreadyBird(canShowBird);

      if (overflowPx <= 1) {
        return;
      }

      const duration = Math.max(
        UNREADY_SCROLL_DURATION_MS,
        Math.round(overflowPx * 90),
      );
      const animation = track.animate(
        [
          { transform: "translateY(0px)", offset: 0 },
          { transform: "translateY(0px)", offset: 0.14 },
          { transform: `translateY(${-overflowPx}px)`, offset: 0.64 },
          { transform: `translateY(${-overflowPx}px)`, offset: 0.84 },
          { transform: "translateY(0px)", offset: 1 },
        ],
        {
          duration,
          easing: "linear",
          iterations: Infinity,
          fill: "both",
        },
      );
      unreadyAnimationsRef.current = [animation];
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(updateLayout);
    };

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(viewport);
    resizeObserver.observe(track);
    scheduleUpdate();

    return () => {
      window.cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      for (const animation of unreadyAnimationsRef.current) {
        animation.cancel();
      }
      unreadyAnimationsRef.current = [];
    };
  }, [unreadyLayoutSignature]);

  useEffect(() => {
    for (const animation of readyAnimationsRef.current) {
      animation.cancel();
    }
    readyAnimationsRef.current = [];

    const viewport = readyViewportRef.current;
    const track = readyTrackRef.current;
    if (!viewport || !track || orderedReady.length === 0) {
      return;
    }

    let raf = 0;
    const updateLayout = () => {
      for (const animation of readyAnimationsRef.current) {
        animation.cancel();
      }
      readyAnimationsRef.current = [];
      track.style.transform = "translateY(0px)";

      const viewportStyle = window.getComputedStyle(viewport);
      const viewportPaddingY =
        (Number.parseFloat(viewportStyle.paddingTop) || 0) +
        (Number.parseFloat(viewportStyle.paddingBottom) || 0);
      const visibleHeight = Math.max(
        0,
        viewport.clientHeight - viewportPaddingY,
      );
      const overflowPx = Math.max(0, track.scrollHeight - visibleHeight + 2);
      if (overflowPx <= 1) {
        return;
      }

      const duration = Math.max(
        READY_SCROLL_DURATION_MS,
        Math.round(overflowPx * 40),
      );
      const animation = track.animate(
        [
          { transform: "translateY(0px)", offset: 0 },
          { transform: "translateY(0px)", offset: 0.14 },
          { transform: `translateY(${-overflowPx}px)`, offset: 0.64 },
          { transform: `translateY(${-overflowPx}px)`, offset: 0.84 },
          { transform: "translateY(0px)", offset: 1 },
        ],
        {
          duration,
          easing: "linear",
          iterations: Infinity,
          fill: "both",
        },
      );
      readyAnimationsRef.current = [animation];
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(updateLayout);
    };

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(viewport);
    resizeObserver.observe(track);
    scheduleUpdate();

    return () => {
      window.cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      for (const animation of readyAnimationsRef.current) {
        animation.cancel();
      }
      readyAnimationsRef.current = [];
    };
  }, [readyLayoutSignature, readyMode, readyColumns]);

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
        marqueeText ? "has-marquee" : "no-marquee",
      ].join(" ")}
    >
      <div className="order-display-empty">注文はありません</div>

      <div
        className="order-display-panels"
        style={
          {
            "--ready-count": String(Math.max(1, readyOrders.length)),
            "--ready-columns": String(readyColumns),
            "--unready-count": String(Math.max(1, unreadyOrders.length)),
          } as CSSProperties
        }
      >
        <section
          className={[
            "order-display-panel order-display-panel-unready",
            showUnreadyBird ? "has-bird" : "no-bird",
          ].join(" ")}
        >
          <header className="order-display-panel-header">
            <span>調理中です</span>
          </header>
          {hasUnready ? (
            <div
              ref={unreadyViewportRef}
              className="order-display-unready-viewport"
            >
              <div
                ref={unreadyTrackRef}
                className="order-display-tile-grid order-display-unready-grid"
              >
                {orderedUnready.map((order) => (
                  <article
                    key={order.id}
                    className={`order-display-unready-tile ${tileTone(order)}`}
                  >
                    <strong
                      className="order-display-order-number"
                      style={orderNumberStyle(order.orderNo)}
                    >
                      {order.orderNo}
                    </strong>
                  </article>
                ))}
              </div>
              <img
                className="order-display-unready-bird"
                src="/images/order-display-bird.png"
                alt=""
                aria-hidden="true"
              />
            </div>
          ) : (
            <div className="order-display-panel-empty">
              調理中の注文はありません
            </div>
          )}
        </section>

        <section className="order-display-panel order-display-panel-ready">
          <header className="order-display-panel-header">
            <span>カウンターへお越しください</span>
          </header>
          <div ref={readyViewportRef} className="order-display-ready-viewport">
            <div
              ref={readyTrackRef}
              className={`order-display-ready-grid order-display-ready-grid-${readyMode}`}
            >
              {orderedReady.map((order) => (
                <article key={order.id} className="order-display-ready-tile">
                  <strong
                    className="order-display-order-number"
                    style={orderNumberStyle(order.orderNo)}
                  >
                    {order.orderNo}
                  </strong>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>

      {marqueeText && (
        <aside
          className="order-display-marquee"
          style={
            {
              "--marquee-duration": `${settings.orderDisplayMarqueeSpeedSeconds}s`,
            } as CSSProperties
          }
        >
          <div className="order-display-marquee-track">
            <span>{marqueeText}</span>
            <span>{marqueeText}</span>
            <span>{marqueeText}</span>
          </div>
        </aside>
      )}

      {callout && (
        <div
          key={callout.key}
          className={[
            "order-display-callout",
            callout.exiting ? "is-exiting" : "",
          ].join(" ")}
        >
          <span>カウンターへお越しください</span>
          <strong
            className="order-display-order-number"
            style={orderNumberStyle(callout.orderNo)}
          >
            {callout.orderNo}
          </strong>
        </div>
      )}
    </main>
  );
}
