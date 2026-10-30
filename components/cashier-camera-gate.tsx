"use client";
import type { RefObject } from "react";

export function CashierCameraGate({ videoRef }: {
  videoRef: RefObject<HTMLVideoElement | null>; ready: boolean; connecting: boolean; error: string | null; onConnect: () => void;
}) {
  return <video ref={videoRef} muted playsInline autoPlay aria-hidden="true" className="pointer-events-none fixed bottom-0 left-0 h-px w-px overflow-hidden opacity-0" />;
}
