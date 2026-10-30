"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { coalesceRefresh } from "@/lib/client/coalesce-refresh";

export function PhotoStorageBanner() {
  const [state, setState] = useState<{ failed: boolean; ignoreActive: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();
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
  if (!state || (!state.failed && !state.ignoreActive)) return null;
  return <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-amber-950">
    <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1"><p className="font-semibold">{state.ignoreActive ? "本日は画像の保存失敗時も会計を続行します" : "会計者画像を保存できないため、新規会計を停止しています"}</p>{state.ignoreActive && <p className="mt-0.5 text-sm">翌0:00（JST）に通常の制限へ戻ります。</p>}</div>
    {!state.ignoreActive && <Button variant="outline" disabled={busy} onClick={async () => {
      if (!window.confirm("本日（JST）は会計者画像を保存できなくても、新規会計を許可しますか？")) return;
      setBusy(true);
      try { await apiFetch("/api/admin/photo-storage", { method: "POST", body: JSON.stringify({ confirm: true }) }); await reload(); }
      catch (error) { notify({ level: "error", message: error instanceof Error ? error.message : "変更できませんでした" }); }
      finally { setBusy(false); }
    }}>本日の会計を許可</Button>}
  </div>;
}
