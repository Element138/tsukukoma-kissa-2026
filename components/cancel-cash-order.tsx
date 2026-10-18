"use client";

import { useRef, useState } from "react";
import { apiFetch, fmtJpy } from "@/lib/client";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CancelCashOrder({ order, onCanceled }: {
  order: { id: string; orderNo: number; totalPriceJpy: number };
  onCanceled: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("決済方法の選択誤り");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  return <>
    <button type="button" className="ghost-btn" onClick={() => { setError(null); setOpen(true); }}>現金注文を取り消す</button>
    <Dialog open={open} onOpenChange={value => { if (!inFlight.current) setOpen(value); }}>
      <DialogContent>
        <DialogTitle>注文 #{order.orderNo} を取り消しますか？</DialogTitle>
        <DialogDescription>
          現金 {fmtJpy(order.totalPriceJpy)} の会計記録と注文を取り消します。一品でも提供済みの場合は取り消せません。
          現金を受け取っている場合は別途返金してください。この操作は元に戻せません。
        </DialogDescription>
        <label>取消理由<Input value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
        {error && <p role="alert" className="notice error">{error}</p>}
        <div className="row wrap">
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>戻る</Button>
          <Button disabled={busy || !reason.trim()} onClick={async () => {
            if (inFlight.current) return;
            inFlight.current = true;
            setBusy(true); setError(null);
            try {
              await apiFetch(`/api/orders/${order.id}/cancel`, { method: "POST", body: JSON.stringify({ reasonText: reason }) });
              setOpen(false); onCanceled();
            } catch (e) { setError(e instanceof Error ? e.message : "取消に失敗しました"); }
            finally { inFlight.current = false; setBusy(false); }
          }}>{busy ? "取消中…" : "注文と現金会計を取り消す"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
