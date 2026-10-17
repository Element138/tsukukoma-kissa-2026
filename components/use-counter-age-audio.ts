"use client";
import { useEffect, useRef, useState } from "react";
import { CounterAudioPlayer } from "@/lib/client/counter-audio";
import { counterAlertSources, counterOrderNumberSources, dueCounterAlerts, type AlertHistory, type AlertOrder, type CounterAgeAlert } from "@/lib/counter-age-alerts";
import { ORDER_AGE_MINUTES } from "@/lib/order-age";

const BASE_SOURCES = ORDER_AGE_MINUTES.flatMap((minutes, i) => [`/audio/counter-alerts/tone-${i + 1}.mp3`, `/audio/counter-alerts/elapsed-from-order-${minutes}.mp3`]);

export function useCounterAgeAudio(orders: AlertOrder[], actorId: string | undefined, now: number, loadedAt: number) {
  const [enabled, setEnabled] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState("");
  const player = useRef<CounterAudioPlayer | null>(null);
  const active = useRef<{ alert: CounterAgeAlert; controller: AbortController } | null>(null);
  const running = useRef(false);
  const enabledRef = useRef(false);
  const history = useRef<AlertHistory>({});
  const warmed = useRef(new Set<string>());
  const latest = useRef({ orders, loadedAt });
  latest.current = { orders, loadedAt };
  const generation = useRef(0);
  const key = actorId ? `kissa.counter-age-audio.v1:${actorId}` : null;

  useEffect(() => {
    history.current = {};
    warmed.current.clear();
    setEnabled(false); setStarting(false); setSpeaking("");
    if (key) try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        for (const [id, entry] of Object.entries(saved)) {
          const value = entry as { minutes?: number; at?: number };
          if (value && ORDER_AGE_MINUTES.some(n => n === value.minutes) && typeof value.at === "number" && value.at > Date.now() - 3 * 86400_000) {
            history.current[id] = { minutes: value.minutes!, at: value.at };
          }
        }
      }
    } catch { /* Memory history still prevents repeats when storage is unavailable. */ }
    return () => {
      generation.current++; enabledRef.current = false; active.current?.controller.abort();
      player.current?.dispose(); player.current = null;
    };
  }, [key]);

  useEffect(() => {
    const hide = () => { if (document.visibilityState !== "visible") active.current?.controller.abort(); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);

  useEffect(() => {
    if (active.current && (!orders.some(order => order.id === active.current!.alert.id) || now - loadedAt > 30_000)) {
      active.current.controller.abort();
    }
    if (!enabled || running.current || document.visibilityState !== "visible" || !loadedAt || now - loadedAt > 30_000) return;
    const currentPlayer = player.current;
    if (!currentPlayer || !key) return;
    const epoch = generation.current;
    running.current = true;
    void (async () => {
      try {
        while (epoch === generation.current && enabledRef.current && document.visibilityState === "visible" && Date.now() - latest.current.loadedAt <= 30_000) {
          const next = dueCounterAlerts(latest.current.orders, Date.now(), history.current)[0];
          if (!next) break;
          const controller = new AbortController(); active.current = { alert: next, controller };
          setSpeaking(`注文 #${next.orderNo} · ${next.minutes}分経過`);
          await currentPlayer.play(counterAlertSources(next), controller.signal);
          history.current[next.id] = { minutes: next.minutes, at: Date.now() };
          try { localStorage.setItem(key, JSON.stringify(history.current)); } catch { /* Keep in-memory history. */ }
          active.current = null;
        }
      } catch (e) {
        if (!active.current?.controller.signal.aborted && epoch === generation.current) {
          enabledRef.current = false; setEnabled(false);
          setError(e instanceof DOMException && e.name === "AbortError" ? "音声の読み込みがタイムアウトしました。もう一度有効にしてください。" : e instanceof Error ? e.message : "音声通知に失敗しました");
        }
      } finally {
        active.current = null; running.current = false;
        if (epoch === generation.current) setSpeaking("");
      }
    })();
  }, [orders, now, loadedAt, enabled, key]);

  useEffect(() => {
    if (!enabled || !player.current) return;
    const sources = new Set(BASE_SOURCES);
    for (const order of orders) for (const src of counterOrderNumberSources(order.orderNo)) sources.add(src);
    player.current.prune(sources);
    // Warm only imminently needed numbers, keeping large counter lists inexpensive.
    for (const order of orders) {
      const age = now - Date.parse(order.createdAt);
      if (ORDER_AGE_MINUTES.some(minutes => age >= minutes * 60_000 - 30_000 && (history.current[order.id]?.minutes ?? 0) < minutes)) {
        const numberSources = counterOrderNumberSources(order.orderNo);
        if (numberSources.some(src => !warmed.current.has(src))) {
          numberSources.forEach(src => warmed.current.add(src));
          void player.current.preload(numberSources).catch(() => {});
        }
      }
    }
  }, [orders, enabled, now]);

  const enable = async () => {
    if (starting || !actorId) return;
    setStarting(true); setError("");
    const epoch = generation.current;
    warmed.current.clear();
    try {
      const current = player.current ?? new CounterAudioPlayer(); player.current = current;
      await current.unlock();
      await current.preload(BASE_SOURCES);
      if (epoch !== generation.current) return;
      enabledRef.current = true; setEnabled(true);
    } catch (e) { setError(e instanceof Error ? e.message : "音声を有効にできませんでした"); }
    finally { setStarting(false); }
  };
  const disable = () => {
    enabledRef.current = false; setEnabled(false); active.current?.controller.abort();
  };
  return { enabled, starting, error, speaking, enable, disable };
}
