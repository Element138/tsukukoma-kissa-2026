"use client";
import type { RefObject } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CashierCameraGate({ videoRef, ready, connecting, error, onConnect }: {
  videoRef: RefObject<HTMLVideoElement | null>; ready: boolean; connecting: boolean; error: string | null; onConnect: () => void;
}) {
  return <div className={ready ? "pointer-events-none fixed bottom-0 left-0 h-px w-px overflow-hidden opacity-0" : "fixed inset-0 z-[90] flex items-center justify-center bg-slate-50/95 px-5"}>
    <section role={ready ? undefined : "dialog"} aria-modal={ready ? undefined : true} aria-labelledby="cashier-camera-title" className={ready ? "" : "w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"}>
      {!ready && <><Camera className="mb-4 h-6 w-6 text-slate-600" aria-hidden="true" /><h1 id="cashier-camera-title" className="text-xl font-semibold tracking-tight">カメラを接続してください</h1><p className="mt-2 text-sm text-slate-600">POSの利用には前面カメラの許可が必要です。</p></>}
      <video ref={videoRef} muted playsInline autoPlay aria-hidden="true" className="pointer-events-none absolute h-px w-px opacity-0" />
      {!ready && <>{error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}<Button className="mt-5 w-full" disabled={connecting} onClick={onConnect}>{connecting ? "カメラを確認中…" : "カメラを接続"}</Button></>}
    </section>
  </div>;
}
