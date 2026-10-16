"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";

export function SquareIncidentBanner() {
  const [count, setCount] = useState(0);
  const reload = useCallback(async () => {
    try {
      const result = await apiFetch<{ incidentCount: number }>("/api/admin/square-payments?summary=1", { retry: 1 });
      setCount(result.incidentCount);
    } catch { /* Keep the last confirmed count during a temporary outage. */ }
  }, []);
  useEffect(() => {
    void reload();
    const refresh = () => { if (document.visibilityState === "visible") void reload(); };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [reload]);
  useRealtimeSubscription({ enabled: true, channels: ["orders"], onEvent: () => void reload(), onResync: () => void reload() });
  if (count === 0) return null;
  return <Link href="/admin/square-payments" role="status" className="mb-4 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-amber-950 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
    <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1"><p className="font-semibold">Square決済の確認が必要です</p><p className="mt-0.5 text-sm">未確認の通知が{count}件あります。</p></div>
    <span className="flex shrink-0 items-center gap-1 text-sm font-semibold">確認する<ArrowRight className="h-4 w-4" aria-hidden="true" /></span>
  </Link>;
}
