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
  exiting?: boolean;
};

type QueuedCall = {
  id: string;
  orderNo: number;
  createdAt: string;
  followsPrevious: boolean;
};

const ORDER_AGE_LONG_WAIT_MS = 20 * 60 * 1000;
const CALLOUT_MIN_VISIBLE_MS = 5200;
const CALLOUT_FADE_OUT_MS = 450;
const CALL_BURST_WINDOW_MS = 5000;
const UNREADY_SCROLL_DURATION_MS = 36_000;
const READY_SCROLL_DURATION_MS = 28_000;
const ORDER_DISPLAY_REFRESH_MS = 5_000;
const MELODY_GAIN_BOOST = 2.4;
const CALL_ASSETS = {
  melody: "/audio/order-call/call-melody.wav",
  waitLong: "/audio/order-call/wait-long.mp3",
  continued: "/audio/order-call/continued.mp3",
  preparedCounter: "/audio/order-call/prepared-counter.mp3",
  counter: "/audio/order-call/counter.mp3",
};

let orderCallAudioContext: AudioContext | null = null;
const decodedAudioBuffers = new Map<string, Promise<AudioBuffer>>();

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function playAudioElement(audio: HTMLAudioElement) {
  return new Promise<void>((resolve) => {
    audio.currentTime = 0;
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    void audio.play().catch(() => resolve());
  });
}

function waitForAudioReady(audio: HTMLAudioElement) {
  if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      audio.removeEventListener("canplaythrough", onReady);
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("error", onReady);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    audio.addEventListener("canplaythrough", onReady, { once: true });
    audio.addEventListener("canplay", onReady, { once: true });
    audio.addEventListener("error", onReady, { once: true });
  });
}

function preloadAudio(src: string, volume = 1) {
  const audio = new Audio(src);
  audio.preload = "auto";
  audio.volume = Math.max(0, Math.min(1, volume));
  audio.load();
  return audio;
}

function getOrderCallAudioContext() {
  if (!orderCallAudioContext) {
    const AudioContextConstructor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("Web Audio is unavailable");
    }
    orderCallAudioContext = new AudioContextConstructor();
  }
  return orderCallAudioContext;
}

function loadDecodedAudioBuffer(src: string) {
  const existing = decodedAudioBuffers.get(src);
  if (existing) {
    return existing;
  }

  const bufferPromise = fetch(src, {
    credentials: "include",
    cache: "force-cache",
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Audio preload failed: ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .then((arrayBuffer) =>
      getOrderCallAudioContext().decodeAudioData(arrayBuffer),
    );
  decodedAudioBuffers.set(src, bufferPromise);
  return bufferPromise;
}

async function playAudioBuffer(src: string, gainValue: number) {
  const audioContext = getOrderCallAudioContext();
  await audioContext.resume();
  if (audioContext.state === "suspended") {
    throw new Error("Web Audio playback is suspended");
  }
  const audioBuffer = await loadDecodedAudioBuffer(src);

  return new Promise<void>((resolve) => {
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();
    source.buffer = audioBuffer;
    gainNode.gain.value = Math.max(0, gainValue);
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    source.onended = () => {
      source.disconnect();
      gainNode.disconnect();
      resolve();
    };
    source.start();
  });
}

function orderNumberAudioSrc(orderNo: number, part: "number" | "customer") {
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

async function playOrderCallAudio(call: Callout, melodyVolume: number) {
  const isLongWait =
    Date.now() - new Date(call.createdAt).getTime() >= ORDER_AGE_LONG_WAIT_MS;
  const numberAudio = preloadAudio(orderNumberAudioSrc(call.orderNo, "number"));
  const customerAudio = preloadAudio(
    orderNumberAudioSrc(call.orderNo, "customer"),
  );
  await Promise.all([
    waitForAudioReady(numberAudio),
    waitForAudioReady(customerAudio),
  ]);
  if (!call.followsPrevious) {
    await playAudioBuffer(
      CALL_ASSETS.melody,
      melodyVolume * MELODY_GAIN_BOOST,
    ).catch(() =>
      playAudioElement(preloadAudio(CALL_ASSETS.melody, melodyVolume)),
    );
  }
  const parts = [
    call.followsPrevious
      ? preloadAudio(CALL_ASSETS.continued)
      : null,
    isLongWait && !call.followsPrevious
      ? preloadAudio(CALL_ASSETS.waitLong)
      : null,
    numberAudio,
    customerAudio,
    call.followsPrevious ? CALL_ASSETS.counter : CALL_ASSETS.preparedCounter,
  ].filter(Boolean) as Array<string | HTMLAudioElement>;

  for (const part of parts) {
    await playAudioElement(
      typeof part === "string" ? preloadAudio(part) : part,
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

    const visibleStartedAt = Date.now();
    await playOrderCallAudio(activeCall, settings.orderCallVolume);
    await wait(Math.max(0, CALLOUT_MIN_VISIBLE_MS - (Date.now() - visibleStartedAt)));
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
      warmOrderNumberAudio(order.orderNo);
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
        Math.round(overflowPx * 80),
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
                    <strong style={orderNumberStyle(order.orderNo)}>
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
                  <strong style={orderNumberStyle(order.orderNo)}>
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
          <strong style={orderNumberStyle(callout.orderNo)}>
            {callout.orderNo}
          </strong>
        </div>
      )}
    </main>
  );
}
