"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { LoadingScreen } from "@/components/loading-screen";
import { DashboardShell } from "@/components/dashboard-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PendingOrder = { id: string; orderNo: number; totalPriceJpy: number; createdAt: string; createdByActorId: string;
  squareAttempt: { launchedAt: string | null; transactionId: string | null; verifyAttempts: number; lastError: string | null } | null };
function ReconciliationCard({ order, onDone }: { order: PendingOrder; onDone: () => Promise<void> }) {
  const [transactionId, setTransactionId] = useState(order.squareAttempt?.transactionId ?? "");
  const [reason, setReason] = useState("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const run = async (action: "VERIFY" | "NO_CHARGE") => {
    setBusy(true); setMessage("");
    try {
      const result = await apiFetch<{ verified?: boolean; deferred?: boolean; error?: string; closed?: boolean }>("/api/admin/square-payments", {
        method: "POST", body: JSON.stringify({ orderId: order.id, action, transactionId: transactionId.trim() || undefined, reason, attested }),
      });
      setMessage(result.error ?? (result.deferred ? "照合中または再試行の待機中です。30秒以上あけて確認してください。" : "照合結果を記録しました。"));
      await onDone();
    } catch (error) { setMessage(error instanceof Error ? error.message : "照合に失敗しました"); }
    finally { setBusy(false); }
  };
  const disabled = busy || !attested || reason.trim().length < 10;
  return <Card className="space-y-4 p-5">
    <h2 className="text-lg font-semibold">注文 #{order.orderNo} · {fmtJpy(order.totalPriceJpy)}</h2>
    <p>担当POS: {order.createdByActorId} · {new Date(order.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</p>
    <p>{order.squareAttempt?.launchedAt ? "Squareへの起動要求は発行済みです。" : "Squareへの起動記録がありません。"}</p>
    {order.squareAttempt?.lastError && <p role="status">{order.squareAttempt.lastError}</p>}
    <label className="block">Square注文ID（transaction_id。レシート番号・payment_idとは異なります）
      <Input value={transactionId} onChange={event => setTransactionId(event.target.value)} autoComplete="off" />
    </label>
    <label className="block">確認内容（10文字以上。カード番号などは記入しないでください）
      <Input value={reason} onChange={event => setReason(event.target.value)} maxLength={500} />
    </label>
    <label className="flex items-start gap-2"><input type="checkbox" checked={attested} onChange={event => setAttested(event.target.checked)} />
      Squareの取引履歴・元の端末の未完了決済を確認し、この注文との対応、金額、入金または未決済を照合しました。
    </label>
    <div className="flex flex-wrap gap-3">
      <Button disabled={disabled || !transactionId.trim()} onClick={() => void run("VERIFY")}>入金をサーバーで照合</Button>
      <Button variant="outline" disabled={disabled || Boolean(order.squareAttempt?.transactionId)} onClick={() => void run("NO_CHARGE")}>未決済を確認して注文を終了</Button>
    </div>
    <p className="text-sm">「注文を終了」はSquare側の取消・返金を行いません。結果が不明な間は終了せず、再決済も行わないでください。</p>
    {message && <p role="status">{message}</p>}
  </Card>;
}
export default function SquarePaymentsPage() {
  const { loading, session } = useSession(["ADMIN"]);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try { const data = await apiFetch<{ orders: PendingOrder[] }>("/api/admin/square-payments"); setOrders(data.orders); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "取得に失敗しました"); }
  }, []);
  useEffect(() => { if (session) void reload(); }, [session, reload]);
  if (loading || !session) return <LoadingScreen />;
  return <DashboardShell title="Square決済の照合" subtitle="結果が不明な決済は再決済せず、取引履歴で確認してください。">
    <div className="mb-4 flex gap-4"><Link href="/admin">管理画面へ</Link><Link href="/order-book">決済異常・注文履歴</Link><Button variant="outline" onClick={() => void reload()}>更新</Button></div>
    {error && <p role="alert">{error}</p>}
    {!error && !orders.length && <p>照合待ちの注文はありません。</p>}
    <div className="space-y-4">{orders.map(order => <ReconciliationCard key={order.id} order={order} onDone={reload} />)}</div>
  </DashboardShell>;
}
