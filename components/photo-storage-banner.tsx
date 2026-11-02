"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { coalesceRefresh } from "@/lib/client/coalesce-refresh";

export function PhotoStorageBanner() {
  const [state, setState] = useState<{ failed: boolean; ignoreActive: boolean } | null>(null);
  const reload = useMemo(() => coalesceRefresh(async () => {
    try { setState(await apiFetch("/api/admin/photo-storage", { retry: 1 })); } catch { /* Keep the last confirmed state. */ }
  }), []);
  useEffect(() => {
    void reload();
    const refresh = () => { if (document.visibilityState === "visible") void reload(); };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [reload]);
  useRealtimeSubscription({ enabled: true, channels: ["orders"], onEvent: () => void reload(), onResync: () => void reload() });
  if (!state?.failed) return null;
  return <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-amber-950">
    <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1"><p className="font-semibold">会計者画像を保存できません</p><p className="mt-0.5 text-sm">POSを再読み込みすると、画像なしで会計・Square決済を続行できます。</p></div>
  </div>;
}
