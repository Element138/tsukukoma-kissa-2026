"use client";
import { useState } from "react";
import { Camera } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { Button } from "@/components/ui/button";

export function CashierPhotoViewer({ orderId, status }: { orderId: string; status: "STORED" | "WAIVED" | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status) return <p className="mt-3 text-sm text-slate-500">会計者画像：保存なし</p>;
  if (status === "WAIVED") return <p className="mt-3 text-sm text-slate-500">会計者画像：保存なし（管理者承認）</p>;
  return <div className="mt-3">
    <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
      if (url) { setUrl(null); return; }
      setBusy(true); setError(null);
      try { const data = await apiFetch<{ url: string | null }>(`/api/orders/${orderId}/cashier-photo`); setUrl(data.url); }
      catch { setError("画像を読み込めません。もう一度お試しください。"); }
      finally { setBusy(false); }
    }}><Camera className="mr-1.5 h-4 w-4" aria-hidden="true" />{busy ? "読み込み中…" : url ? "会計者画像を閉じる" : "会計者画像"}</Button>
    {url && <img src={url} alt="会計者画像" referrerPolicy="no-referrer" className="mt-3 max-h-80 max-w-full rounded-lg border border-slate-200 object-contain" onError={() => { setUrl(null); setError("画像を読み込めません。もう一度お試しください。"); }} />}
    {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
  </div>;
}
