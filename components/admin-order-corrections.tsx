"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ORDER_STATUS_LABEL, labelOf } from "@/lib/labels";

type Order = {id:string;orderNo:number;orderStatus:string;paymentStatus:string;confirmedAt:string|null;specialNote:string|null;excludeFromWaitStats:boolean;lastMutationVersion:number;items:Array<{status:string}>};
type Draft = {orderId:string;expectedVersion:number;specialNote:string;excludeFromWaitStats:boolean;manualClose:boolean};
export type AdminOrderCorrectionsHandle = {save:()=>Promise<boolean>};

export const AdminOrderCorrections = forwardRef<AdminOrderCorrectionsHandle,{onDirtyChange:(dirty:boolean)=>void}>(function AdminOrderCorrections({onDirtyChange},ref) {
  const {notify}=useToast();
  const [orders,setOrders]=useState<Order[]>([]);
  const [drafts,setDrafts]=useState<Record<string,Draft>>({});
  const [orderNo,setOrderNo]=useState("");
  const [busy,setBusy]=useState(false);
  const inFlight=useRef(false);
  const dirty=Object.keys(drafts).length>0;
  useEffect(()=>onDirtyChange(dirty),[dirty,onDirtyChange]);
  const load=useCallback(async(query="")=>{
    const result=await apiFetch<{orders:Order[]}>(`/api/admin/order-corrections${query?`?orderNo=${encodeURIComponent(query)}`:""}`);
    setOrders(result.orders);
  },[]);
  useEffect(()=>{void load().catch(error=>notify({level:"error",message:error instanceof Error?error.message:"注文を取得できませんでした"}));},[load,notify]);
  const update=(order:Order,patch:Partial<Draft>)=>setDrafts(current=>{
    const next={...current};
    const previous=current[order.id]??{orderId:order.id,expectedVersion:order.lastMutationVersion,specialNote:order.specialNote??"",excludeFromWaitStats:order.excludeFromWaitStats,manualClose:false};
    const draft={...previous,...patch};
    if(draft.specialNote===(order.specialNote??"") && draft.excludeFromWaitStats===order.excludeFromWaitStats && !draft.manualClose) delete next[order.id];
    else next[order.id]=draft;
    return next;
  });
  const save=async()=>{
    if(inFlight.current)return false;
    const changes=Object.values(drafts);
    if(!changes.length)return true;
    const closing=changes.filter(draft=>draft.manualClose);
    if(closing.length && !window.confirm(`手動完了する注文: ${closing.map(draft=>`#${orders.find(order=>order.id===draft.orderId)?.orderNo??draft.orderId}`).join("、")}\n調理済み数にかかわらず、残りの商品をすべて提供済みにし、呼び出しを解除します。備考に manual closure を追記します。決済記録は変更しません。よろしいですか？`))return false;
    inFlight.current=true;setBusy(true);
    try{
      await apiFetch("/api/admin/order-corrections",{method:"PATCH",body:JSON.stringify({changes})});
      setDrafts({});onDirtyChange(false);
      await load(orderNo);
      return true;
    }finally{inFlight.current=false;setBusy(false);}
  };
  useImperativeHandle(ref,()=>({save}));
  return <section className="card mb-3">
    <h2 className="text-lg font-bold mb-3">注文の管理</h2>
    <form className="flex flex-wrap items-end gap-2 mb-3" onSubmit={event=>{event.preventDefault();void load(orderNo).catch(error=>notify({level:"error",message:error instanceof Error?error.message:"取得に失敗しました"}));}}>
      <label className="grid gap-1 text-sm font-semibold">注文番号<Input type="number" min={1} step={1} value={orderNo} onChange={event=>setOrderNo(event.target.value)} placeholder="空欄で未完了注文" /></label>
      <Button type="submit" variant="outline" disabled={busy}>表示</Button>
      {dirty && <Button type="button" variant="outline" disabled={busy} onClick={()=>{if(window.confirm("注文の未保存変更をすべて破棄して再読み込みしますか？")){setDrafts({});void load(orderNo).catch(error=>notify({level:"error",message:error instanceof Error?error.message:"取得に失敗しました"}));}}}>変更を破棄して再読込</Button>}
    </form>
    <p className="muted text-xs mb-3">未完了注文を最大100件表示します。過去の注文は注文番号で検索できます。変更は「すべて保存」で反映されます。</p>
    <div className="grid gap-3">
      {orders.length===0 && <p className="muted">該当する注文はありません</p>}
      {orders.map(order=>{
        const draft=drafts[order.id];
        const canClose=Boolean(order.confirmedAt && ["PAID","SKIPPED"].includes(order.paymentStatus) && !["COMPLETED","FAILED","CANCELED"].includes(order.orderStatus));
        return <article key={order.id} className="rounded-lg border p-3 grid gap-2">
          <div className="row between wrap"><strong>注文 #{order.orderNo}</strong><span className="badge">{labelOf(ORDER_STATUS_LABEL,order.orderStatus)}</span></div>
          <label className="grid gap-1 text-sm font-semibold">備考<textarea aria-label="備考" className="rounded-md border bg-background p-2 font-normal" maxLength={500} disabled={busy} value={draft?.specialNote??order.specialNote??""} onChange={event=>update(order,{specialNote:event.target.value})} /></label>
          <label className="admin-order-toggle"><input type="checkbox" disabled={busy} checked={draft?.excludeFromWaitStats??order.excludeFromWaitStats} onChange={event=>update(order,{excludeFromWaitStats:event.target.checked})} />待ち時間統計から除外する</label>
          {canClose && <label className="admin-order-toggle font-semibold"><input type="checkbox" disabled={busy} checked={draft?.manualClose??false} onChange={event=>update(order,{manualClose:event.target.checked})} />手動完了（全商品を提供済みにする）</label>}
        </article>;
      })}
    </div>
    {dirty && <p className="notice mt-3" role="status">注文に未保存の変更があります。</p>}
  </section>;
});
