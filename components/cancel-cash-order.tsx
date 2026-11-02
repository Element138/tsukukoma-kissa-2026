"use client";

import { useRef, useState } from "react";
import { ApiError, apiFetch, fmtJpy } from "@/lib/client";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReceiptPrintTarget } from "@/lib/receipt/types";

export function CancelCashOrder({ order, onCanceled }: {
  order: { id: string; orderNo: number; totalPriceJpy: number };
  onCanceled: (target: ReceiptPrintTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [items,setItems]=useState<Array<{id:string;itemNameSnapshot:string;unitPriceJpy:number;status:string}>>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [confirmed,setConfirmed]=useState(false);
  const requestKey=useRef("");
  const [uncertain,setUncertain]=useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const amount=items.filter(item=>selected.includes(item.id)).reduce((sum,item)=>sum+item.unitPriceJpy,0);
  return <>
    <Button type="button" variant="destructive" onClick={async () => {
      setError(null);setOpen(true);setBusy(true);setItems([]);setSelected([]);setConfirmed(false);setUncertain(false);setReason("");requestKey.current=crypto.randomUUID();
      try{const data=await apiFetch<{order:{items:typeof items}}>(`/api/orders/${order.id}/refunds`);setItems(data.order.items);}catch(e){setError(e instanceof Error?e.message:"取得できません");}finally{setBusy(false);}
    }}>取消・返金</Button>
    <Dialog open={open} onOpenChange={value => { if (!inFlight.current && !uncertain) setOpen(value); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>注文 #{order.orderNo} の取消・返金</DialogTitle>
        <DialogDescription>
          商品を選択し、現金で返金してから確定してください。Square上の決済は変更されません。
        </DialogDescription>
        {items.map(item=><label key={item.id} className={`row between ${item.status==="CANCELED"?"opacity-40":""}`}><span className="row"><input type="checkbox" style={{width:"auto"}} disabled={busy||uncertain||item.status==="CANCELED"} checked={selected.includes(item.id)} onChange={e=>setSelected(current=>e.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))}/>{item.itemNameSnapshot}{item.status==="CANCELED"?"（取消済み）":""}</span><span>{fmtJpy(item.unitPriceJpy)}</span></label>)}
        <strong>返金額 {fmtJpy(amount)}</strong>
        <label>取消理由<Input value={reason} maxLength={500} disabled={busy||uncertain} onChange={event => setReason(event.target.value)} /></label>
        <label className="row"><input type="checkbox" style={{width:"auto"}} checked={confirmed} disabled={busy||uncertain} onChange={e=>setConfirmed(e.target.checked)}/>現金 {fmtJpy(amount)} を返金しました</label>
        {error && <p role="alert" className="notice error">{error}</p>}
        <div className="row wrap">
          <Button variant="outline" disabled={busy||uncertain} onClick={() => setOpen(false)}>戻る</Button>
          <Button variant="destructive" disabled={busy || !reason.trim() || !selected.length || !confirmed} onClick={async () => {
            if (inFlight.current) return;
            inFlight.current = true;
            setBusy(true); setError(null);
            try {
              const data=await apiFetch<{refund:{id:string}}>(`/api/orders/${order.id}/refunds`, { method: "POST", body: JSON.stringify({ itemIds:selected,reasonText:reason,expectedAmountJpy:amount,idempotencyKey:requestKey.current,cashRefundConfirmed:true }) });
              setUncertain(false);setOpen(false);onCanceled({id:order.id,orderNo:order.orderNo,refundId:data.refund.id});
            } catch (e) {
              const definitive = e instanceof ApiError && e.status >= 400 && e.status < 500 && ![408,429].includes(e.status);
              setUncertain(!definitive);
              setError(`${e instanceof Error ? e.message : "確認できませんでした"}。${definitive ? "追加で返金せず、注文の記録と現金を確認してください。" : "追加で返金せず、同じ内容で再試行してください。"}`);
            }
            finally { inFlight.current = false; setBusy(false); }
          }}>{busy ? "確定中…" : uncertain ? "同じ返金記録を再確認" : "取消・現金返金を確定"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
