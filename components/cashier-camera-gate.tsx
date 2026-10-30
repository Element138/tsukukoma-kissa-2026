"use client";
import type { RefObject } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CashierCameraGate({ videoRef, ready, connecting, error, onConnect }: {
  videoRef: RefObject<HTMLVideoElement | null>; ready: boolean; connecting: boolean; error: string | null; onConnect: () => void;
}) {
  return <div className={ready ? "pointer-events-none fixed bottom-0 left-0 h-px w-px overflow-hidden opacity-0" : "mx-auto mt-3 max-w-5xl px-4"}>
    <section role={ready ? undefined : "status"} aria-labelledby="cashier-camera-title" className={ready ? "" : "flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"}>
      {!ready && <><Camera className="h-5 w-5 text-slate-600" aria-hidden="true" /><div className="flex-1"><p id="cashier-camera-title" className="font-semibold">会計者画像の撮影は任意です</p><p className="text-slate-600">カメラを利用できなくても会計・Square決済を続行できます。</p></div></>}
      <video ref={videoRef} muted playsInline autoPlay aria-hidden="true" className="pointer-events-none absolute h-px w-px opacity-0" />
      {!ready && <>{error && <p className="w-full text-slate-600">{error}</p>}<Button variant="outline" disabled={connecting} onClick={onConnect}>{connecting ? "カメラを確認中…" : "カメラを接続（任意）"}</Button></>}
    </section>
  </div>;
}
