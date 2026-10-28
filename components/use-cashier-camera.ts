"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { CASHIER_PHOTO_MAX_BYTES } from "@/lib/cashier-photo-policy";

async function freshFrame(video: HTMLVideoElement) {
  const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
  if (!track) throw new Error("カメラの映像が接続されていません");
  if (track.readyState !== "live") throw new Error("カメラの接続が切れました");
  if (document.visibilityState !== "visible") throw new Error("POSの画面を表示してください");
  const start = performance.now();
  const previous = video.currentTime;
  while (performance.now() - start < 3_000) {
    if (video.readyState >= 2 && video.videoWidth && video.currentTime > previous && track.readyState === "live" && !track.muted) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("カメラの映像を確認できません。再接続してください");
}

async function pendingFrame(key: string, image?: Blob): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("kissa.cashier-frames.v1", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("frames");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("frames", image ? "readwrite" : "readonly");
      const request = image ? tx.objectStore("frames").put(image, key) : tx.objectStore("frames").get(key);
      let result: Blob | null = null;
      request.onsuccess = () => { result = image ?? request.result ?? null; };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}

export async function forgetCashierFrame(key: string) {
  const open = indexedDB.open("kissa.cashier-frames.v1", 1);
  open.onupgradeneeded = () => open.result.createObjectStore("frames");
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction("frames", "readwrite");
    tx.objectStore("frames").delete(key);
    tx.oncomplete = () => db.close();
  };
}

export function useCashierCamera(enabled: boolean, actorId?: string) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const frames = useRef(new Map<string, Blob>());
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    generation.current++;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setReady(false);
    setConnecting(false);
  }, []);

  const start = useCallback(async () => {
    stop();
    const request = generation.current;
    setConnecting(true);
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("このブラウザではカメラを使用できません");
      // A preference (ideal) can silently choose the rear camera; require user-facing.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        facingMode: { exact: "user" }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 10 },
      } });
      if (!mounted.current || generation.current !== request || document.visibilityState !== "visible") {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("カメラを接続できません");
      const track = stream.getVideoTracks()[0];
      track.onended = () => setReady(false);
      track.onmute = () => setReady(false);
      track.onunmute = () => { void freshFrame(video).then(() => { if (streamRef.current === stream) setReady(true); }).catch(() => setReady(false)); };
      video.srcObject = stream;
      await video.play();
      await freshFrame(video);
      if (mounted.current && generation.current === request) setReady(true);
    } catch (cause) {
      if (mounted.current && generation.current === request) {
        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        setReady(false);
        setError(cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "ブラウザの設定でカメラを許可してください"
          : cause instanceof Error && !(cause instanceof DOMException) ? cause.message : "前面カメラを使用できません");
      }
    } finally { if (mounted.current && generation.current === request) setConnecting(false); }
  }, [stop]);

  useEffect(() => {
    mounted.current = true;
    if (enabled) void start();
    const onVisible = () => {
      if (!enabled) return;
      if (document.visibilityState === "visible") void start();
      else stop();
    };
    document.addEventListener("visibilitychange", onVisible);
    let lastTime = -1;
    let lastFrameAt = performance.now();
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || track.readyState !== "live" || track.muted) setReady(false);
      if (video && video.currentTime !== lastTime) { lastTime = video.currentTime; lastFrameAt = performance.now(); }
      if (performance.now() - lastFrameAt > 3_000) setReady(false);
    }, 500);
    return () => { mounted.current = false; document.removeEventListener("visibilitychange", onVisible); clearInterval(timer); stop(); };
  }, [enabled, start, stop]);

  const capture = async () => {
    const video = videoRef.current;
    if (!ready || !video) throw new Error("前面カメラを接続してください");
    try { await freshFrame(video); }
    catch (cause) { setReady(false); throw cause; }
    const scale = Math.min(640 / video.videoWidth, 480 / video.videoHeight, 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("撮影できません。カメラを再接続してください");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.65, 0.5, 0.35, 0.2]) {
      const image = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
      if (image && image.size > 0 && image.size <= CASHIER_PHOTO_MAX_BYTES) return image;
    }
    throw new Error("撮影画像を100 KB以下にできません。もう一度撮影してください");
  };

  const prepare = async (checkoutKey: string) => {
    // Check a live frame even when recovering an already uploaded image.
    if (!videoRef.current || !ready) throw new Error("前面カメラを接続してください");
    await freshFrame(videoRef.current);
    const challenge = await apiFetch<{ photoId: string; stored: boolean }>("/api/pos/cashier-photos", {
      method: "POST", body: JSON.stringify({ checkoutKey }),
    });
    if (challenge.stored) return;
    const cacheKey = `${actorId}:${checkoutKey}`;
    let image = frames.current.get(cacheKey) ?? await pendingFrame(cacheKey).catch(() => null);
    if (!image) {
      image = await capture();
      frames.current.set(cacheKey, image);
      await pendingFrame(cacheKey, image).catch(() => undefined);
    }
    const result = await apiFetch<{ stored: boolean; ignoreAllowed: boolean }>(`/api/pos/cashier-photos/${challenge.photoId}`, {
      method: "POST", headers: { "Content-Type": "image/jpeg" }, body: image, timeoutMs: 30_000,
    });
    if (!result.stored && !result.ignoreAllowed) throw new Error("画像を保存できないため新規会計を停止しています。管理者に確認してください");
  };

  const forget = (key: string) => {
    const cacheKey = `${actorId}:${key}`;
    frames.current.delete(cacheKey);
    void forgetCashierFrame(cacheKey);
  };
  return { videoRef, ready, connecting, error, start, prepare, forget };
}
