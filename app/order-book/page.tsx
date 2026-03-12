"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import {
  FULFILLMENT_LABEL,
  ORDER_ITEM_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  labelOf
} from "@/lib/labels";
import { routeByActorType } from "@/lib/routes";
import { useToast } from "@/components/toast";

type OrderRow = {
  id: string;
  orderNo: number;
  createdAt: string;
  completedAt: string | null;
  fulfillmentType: "DINE_IN" | "TAKEOUT";
  tableNo: number | null;
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  totalPriceJpy: number;
  specialNote: string | null;
  items: Array<{
    id: string;
    name: string;
    status: string;
    kitchenId: string | null;
    kitchenName?: string;
  }>;
};

function formatMss(seconds: number) {
  const sec = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export default function OrderBookPage() {
  const { loading, session } = useSession(["POS", "KITCHEN", "WAITER", "ADMIN"]);
  const { notify } = useToast();

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [status, setStatus] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [qOrderNo, setQOrderNo] = useState("");
  const [tickNow, setTickNow] = useState(Date.now());
  const reloadInFlightRef = useRef(false);

  const reload = async () => {
    if (reloadInFlightRef.current) {
      return;
    }
    reloadInFlightRef.current = true;

    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (paymentMethod) params.set("paymentMethod", paymentMethod);
      if (qOrderNo) params.set("orderNo", qOrderNo);

      const data = await apiFetch<{ orders: OrderRow[] }>(`/api/order-book?${params.toString()}`);
      setOrders(data.orders);
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "注文一覧の取得に失敗しました" });
    } finally {
      reloadInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!session) return;
    void reload();
  }, [session, status, paymentMethod, qOrderNo]);

  useEffect(() => {
    const timer = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useRealtimeSubscription({
    enabled: Boolean(session),
    channels: ["orders", "actors"],
    onEvent: () => {
      void reload();
    },
    onResync: () => {
      void reload();
    }
  });

  const editNote = async (orderId: string, next: string) => {
    try {
      await apiFetch(`/api/orders/${orderId}/note`, {
        method: "PATCH",
        body: JSON.stringify({ specialNote: next })
      });
      notify({ level: "success", message: "備考を更新しました" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "備考更新に失敗しました" });
    }
  };

  const reprint = async (orderId: string) => {
    try {
      const data = await apiFetch<{ printed: boolean; receiptPreview: string }>(`/api/orders/${orderId}/receipt`, {
        method: "POST"
      });
      notify({
        level: "success",
        message: data.printed ? "レシートを印刷しました" : `レシートプレビュー: ${data.receiptPreview}`,
        durationMs: data.printed ? 3500 : 9000
      });
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "レシート再印刷に失敗しました" });
    }
  };

  const rows = useMemo(() => {
    return orders.map((order) => {
      const createdMs = new Date(order.createdAt).getTime();
      const completedMs = order.completedAt ? new Date(order.completedAt).getTime() : null;
      const elapsedSec =
        order.orderStatus === "COMPLETED" && completedMs
          ? Math.max(0, Math.floor((completedMs - createdMs) / 1000))
          : Math.max(0, Math.floor((tickNow - createdMs) / 1000));

      return {
        ...order,
        elapsedLabel: order.orderStatus === "COMPLETED" ? `提供完了まで ${formatMss(elapsedSec)}` : `注文から ${formatMss(elapsedSec)}`
      };
    });
  }, [orders, tickNow]);

  if (loading || !session) {
    return <main>読み込み中...</main>;
  }

  const canEditNote = session.actor.actorType === "POS" || session.actor.actorType === "ADMIN";

  return (
    <>
      <TerminalBanner actorId={session.actor.actorId} actorType={session.actor.actorType} actorLabel={session.actor.label} offlineActors={session.offlineActors} />
      <main>
        <div className="row between wrap" style={{ marginBottom: 12 }}>
          <h1 style={{ margin: 0 }}>オーダーブック</h1>
          <div className="row wrap">
            <Link href={routeByActorType(session.actor.actorType)} className="btn-link ghost-btn">
              戻る
            </Link>
            <button type="button" className="ghost-btn" onClick={() => void reload()}>
              更新
            </button>
            <a href="/api/order-book/export" className="btn-link ghost-btn">
              CSV出力
            </a>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row wrap">
            <input placeholder="注文番号" value={qOrderNo} onChange={(e) => setQOrderNo(e.target.value)} style={{ maxWidth: 120 }} />
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">状態: すべて</option>
              <option value="PENDING">{labelOf(ORDER_STATUS_LABEL, "PENDING")}</option>
              <option value="PREPARING">{labelOf(ORDER_STATUS_LABEL, "PREPARING")}</option>
              <option value="AWAITING_SERVING">{labelOf(ORDER_STATUS_LABEL, "AWAITING_SERVING")}</option>
              <option value="COMPLETED">{labelOf(ORDER_STATUS_LABEL, "COMPLETED")}</option>
              <option value="CANCELED">{labelOf(ORDER_STATUS_LABEL, "CANCELED")}</option>
            </select>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">決済: すべて</option>
              <option value="CASH">{labelOf(PAYMENT_METHOD_LABEL, "CASH")}</option>
              <option value="SQUARE">{labelOf(PAYMENT_METHOD_LABEL, "SQUARE")}</option>
              <option value="PAYMENT_SKIPPED">{labelOf(PAYMENT_METHOD_LABEL, "PAYMENT_SKIPPED")}</option>
            </select>
          </div>
        </div>

        <div className="list">
          {rows.map((order) => (
            <article key={order.id} className="card">
              <div className="row between wrap">
                <div>
                  <strong>注文 #{order.orderNo}</strong>
                  <div className="muted">
                    {labelOf(FULFILLMENT_LABEL, order.fulfillmentType)}
                    {order.tableNo ? ` / テーブル ${order.tableNo}` : ""} / {labelOf(PAYMENT_METHOD_LABEL, order.paymentMethod)}
                  </div>
                  <div className="muted">{order.elapsedLabel}</div>
                </div>
                <div className="row wrap">
                  <span className="badge">{labelOf(ORDER_STATUS_LABEL, order.orderStatus)}</span>
                  <span className="badge">{labelOf(PAYMENT_STATUS_LABEL, order.paymentStatus)}</span>
                  <strong>{fmtJpy(order.totalPriceJpy)}</strong>
                </div>
              </div>

              <div className="list" style={{ marginTop: 10 }}>
                {order.items.map((item) => (
                  <div key={item.id} className="list-item row between wrap">
                    <div>
                      {item.name}
                      <span className={`badge ${item.status === "READY" ? "ready" : item.status === "SERVED" ? "served" : "queued"}`} style={{ marginLeft: 8 }}>
                        {labelOf(ORDER_ITEM_STATUS_LABEL, item.status)}
                      </span>
                      {item.kitchenName && (
                        <span className="muted" style={{ marginLeft: 8 }}>
                          {item.kitchenName}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="row wrap" style={{ marginTop: 10 }}>
                <button type="button" className="ghost-btn" onClick={() => reprint(order.id)}>
                  レシート再印刷
                </button>
                {canEditNote && order.orderStatus !== "COMPLETED" && order.orderStatus !== "CANCELED" && (
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      const next = prompt("備考", order.specialNote ?? "");
                      if (next !== null) {
                        void editNote(order.id, next);
                      }
                    }}
                  >
                    備考編集
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </main>
    </>
  );
}
