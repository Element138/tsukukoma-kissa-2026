"use client";
import type { RefObject } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CashierCameraGate({ videoRef, ready, connecting, error, onConnect }: {
  videoRef: RefObject<HTMLVideoElement | null>; ready: boolean; connecting: boolean; error: string | null; onConnect: () => void;
}) {
  return <>
    <video ref={videoRef} muted playsInline autoPlay aria-hidden="true" className="pointer-events-none fixed bottom-0 left-0 h-px w-px overflow-hidden opacity-0" />
    {!ready && <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 pt-3 text-sm">
      <Button type="button" variant="outline" size="sm" disabled={connecting} onClick={onConnect}>
        <Camera className="mr-1.5 h-4 w-4" aria-hidden="true" />{connecting ? "カメラ接続中…" : "カメラ接続"}
      </Button>
      {error && <span role="status" className="text-slate-500">{error}</span>}
    </div>}
  </>;
}
