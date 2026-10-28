"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, CreditCard, RefreshCw, ShieldCheck } from "lucide-react";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { useToast } from "@/components/toast";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { LoadingScreen } from "@/components/loading-screen";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PendingOrder = {
  id: string; orderNo: number; totalPriceJpy: number; createdAt: string; createdByActorId: string;
  squareAttempt: { launchedAt: string | null; transactionId: string | null; verifyAttempts: number; lastError: string | null } | null;
};
type Incident = { id: string; orderId: string; messageJa: string; incidentType: string; order: { orderNo: number; paymentStatus: string } };
type Result = { verified?: boolean; deferred?: boolean; error?: string; closed?: boolean; paymentFound?: boolean; lateSuccess?: boolean };
const dateLabel = (value: string) => new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function ReconciliationCard({ order, onResult }: { order: PendingOrder; onResult: (result: Result) => Promise<void> }) {
  const [transactionId, setTransactionId] = useState(order.squareAttempt?.transactionId ?? "");
  const [reason, setReason] = useState("");
  const [attested, setAttested] = useState(false);
  const [action, setAction] = useState<"VERIFY" | "NO_CHARGE" | null>(null);
  const [message, setMessage] = useState("");
  const busy = action !== null;
  const run = async (next: "VERIFY" | "NO_CHARGE") => {
    setAction(next); setMessage("");
    try {
      const result = await apiFetch<Result>("/api/admin/square-payments", {
        method: "POST", timeoutMs: 60_000,
        body: JSON.stringify({ orderId: order.id, action: next, transactionId: transactionId.trim() || undefined, reason, attested }),
      });
      setMessage(result.error ?? (result.deferred ? "照合処理中です。少し待って再確認してください。" : ""));
      await onResult(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : "照合に失敗しました"); }
    finally { setAction(null); }
  };
  const disabled = busy || !attested || reason.trim().length < 10;
  return <Card className="overflow-hidden border-slate-200 bg-white/95">
    <CardHeader className="border-b border-slate-100 bg-slate-50/70 p-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><CardTitle className="text-xl">注文 #{order.orderNo}</CardTitle><p className="mt-1.5 text-sm text-muted-foreground">{dateLabel(order.createdAt)} · 担当POS {order.createdByActorId}</p></div>
        <div className="text-right"><p className="text-2xl font-bold tabular-nums tracking-tight">{fmtJpy(order.totalPriceJpy)}</p><Badge variant="outline" className="mt-1 border-amber-200 bg-amber-50 text-amber-800">決済未確認</Badge></div>
      </div>
    </CardHeader>
    <CardContent className="space-y-5 p-5 sm:p-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm leading-relaxed text-amber-950" role="status">
        {order.squareAttempt?.lastError ?? (order.squareAttempt?.launchedAt ? "Squareの取引履歴と照合してください。" : "Squareへの起動記録がありません。")}
      </div>
      <details className="rounded-lg border border-slate-200 px-3 py-2.5">
        <summary className="cursor-pointer text-sm font-medium">Square注文IDを指定する</summary>
        <label className="mt-3 block space-y-1.5 text-sm"><span>Square注文ID</span>
          <Input value={transactionId} onChange={event => setTransactionId(event.target.value)} autoComplete="off" disabled={busy} />
          <span className="block text-xs leading-relaxed text-muted-foreground">取引を特定できない場合に入力してください。レシート番号・決済IDとは異なります。</span>
        </label>
      </details>
      <label className="block space-y-2 text-sm font-medium"><span>確認内容</span>
        <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} disabled={busy} rows={2}
          placeholder="確認した店舗・金額・取引時刻など（10文字以上）" className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50" />
      </label>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed">
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-teal-700" checked={attested} disabled={busy} onChange={event => setAttested(event.target.checked)} />
        <span>元のSquare端末に未完了の決済がないことを確認し、取引履歴とこの注文を照合しました。</span>
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button disabled={disabled} onClick={() => void run("VERIFY")} className="gap-2"><RefreshCw className="h-4 w-4" aria-hidden="true" />{action === "VERIFY" ? "確認中…" : "支払い状況を再確認"}</Button>
        <Button variant="outline" disabled={disabled} onClick={() => void run("NO_CHARGE")}>{action === "NO_CHARGE" ? "Squareに確認中…" : "未決済を確認して注文を終了"}</Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">終了前にSquareへ再確認します。入金があれば決済済みとして処理します。Square側の取消・返金は行いません。</p>
      {message && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-800">{message}</p>}
    </CardContent>
  </Card>;
}

export default function SquarePaymentsPage() {
  const { loading, session } = useSession(["ADMIN"]);
  const { notify } = useToast();
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setRefreshing(true);
    try {
      const data = await apiFetch<{ orders: PendingOrder[]; incidents: Incident[] }>("/api/admin/square-payments");
      if (request !== generation.current) return;
      setOrders(data.orders); setIncidents(data.incidents ?? []); setError("");
    } catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : "取得に失敗しました"); }
    finally { if (request === generation.current) { setRefreshing(false); setLoaded(true); } }
  }, []);
  useEffect(() => { if (session) void reload(); }, [session, reload]);
  useRealtimeSubscription({ enabled: Boolean(session), channels: ["orders"], onEvent: () => void reload(), onResync: () => void reload() });
  const onResult = async (result: Result) => {
    if (result.lateSuccess) notify({ level: "error", message: "終了済みの注文に入金が見つかりました。決済異常を確認してください。" });
    else if (result.paymentFound && result.verified) notify({ level: "success", message: "Squareへの入金を確認したため、注文を決済済みにしました。" });
    else if (result.verified) notify({ level: "success", message: "入金を確認し、注文を決済済みにしました。" });
    else if (result.closed) notify({ level: "success", message: "未決済を確認し、注文を終了しました。" });
    await reload();
  };
  if (loading || !session) return <LoadingScreen />;
  const otherIncidents = incidents.filter(incident => !orders.some(order => order.id === incident.orderId));
  return <><TerminalBanner actorId={session.actor.actorId} actorType={session.actor.actorType} actorLabel={session.actor.label} offlineActors={session.offlineActors} />
    <DashboardShell className="admin-shell square-review-shell" title="Square決済の照合"
      actions={<Button variant="outline" size="sm" disabled={refreshing} onClick={() => void reload()} className="gap-2"><RefreshCw className="h-4 w-4" aria-hidden="true" />更新</Button>}>
      <Link href="/admin" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden="true" />管理者パネル</Link>
      {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {otherIncidents.length > 0 && <Card className="mb-5 border-amber-200 bg-amber-50/80"><CardHeader><CardTitle className="text-base">確認が必要な取引</CardTitle></CardHeader><CardContent className="space-y-3">
        {otherIncidents.map(incident => <div key={incident.id} className="text-sm leading-relaxed"><strong>注文 #{incident.order.orderNo}</strong><p className="mt-1 text-amber-950">{incident.messageJa}</p></div>)}
        <Button asChild variant="outline" size="sm"><Link href="/order-book">オーダーブックで確認<ArrowUpRight className="ml-1 h-4 w-4" aria-hidden="true" /></Link></Button>
      </CardContent></Card>}
      {!loaded ? <p role="status" className="py-10 text-center text-sm text-muted-foreground">読み込み中…</p> : !error && !orders.length ? <Card><CardContent className="flex flex-col items-center gap-3 px-5 py-14 text-center"><ShieldCheck className="h-9 w-9 text-teal-700" aria-hidden="true" /><p className="font-semibold">照合待ちの注文はありません</p><p className="text-sm text-muted-foreground">支払い状況が未確定の注文があると、ここに表示されます。</p></CardContent></Card> :
        <><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><CreditCard className="h-4 w-4 text-teal-700" aria-hidden="true" />支払い確認待ち<Badge variant="secondary">{orders.length}件</Badge></div>
        <div className="grid items-start gap-4 xl:grid-cols-2">{orders.map(order => <ReconciliationCard key={order.id} order={order} onResult={onResult} />)}</div></>}
    </DashboardShell></>;
}
