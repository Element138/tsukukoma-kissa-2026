"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import {
  FULFILLMENT_LABEL,
  ORDER_ITEM_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  labelOf,
} from "@/lib/labels";
import { routeByActorType } from "@/lib/routes";
import { useToast } from "@/components/toast";
import { Input } from "@/components/ui/input";
import { AGE_GROUPS, type AgeGroupCounts } from "@/lib/age-groups";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type OrderRow = {
  id: string;
  orderNo: number;
  createdAt: string;
  completedAt: string | null;
  fulfillmentType: "DINE_IN" | "TAKEOUT";
  tableNo: number | null;
  ageGroupCounts: AgeGroupCounts;
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

type BundledItem = {
  key: string;
  name: string;
  status: string;
  kitchenName?: string;
  count: number;
};

function formatMss(seconds: number) {
  const sec = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function orderStatusClass(orderStatus: string) {
  switch (orderStatus) {
    case "PENDING":
      return "order-status-pending";
    case "PREPARING":
      return "order-status-preparing";
    case "AWAITING_SERVING":
      return "order-status-awaiting";
    case "COMPLETED":
      return "order-status-completed";
    case "CANCELED":
      return "order-status-canceled";
    default:
      return "";
  }
}

function orderAgeClass(orderStatus: string, elapsedSec: number) {
  if (orderStatus === "COMPLETED" || orderStatus === "CANCELED") {
    return "";
  }
  if (elapsedSec >= 600) {
    return "order-age-danger";
  }
  if (elapsedSec >= 240) {
    return "order-age-warn";
  }
  return "order-age-safe";
}

function bundleItems(items: OrderRow["items"]): BundledItem[] {
  const bucket = new Map<string, BundledItem>();

  for (const item of items) {
    const kitchenName = item.kitchenName ?? "";
    const key = `${item.name}::${item.status}::${kitchenName}`;
    const existing = bucket.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }

    bucket.set(key, {
      key,
      name: item.name,
      status: item.status,
      kitchenName: item.kitchenName,
      count: 1,
    });
  }

  return [...bucket.values()];
}

export default function OrderBookPage() {
  const { loading, session } = useSession([
    "POS",
    "KITCHEN",
    "WAITER",
    "ADMIN",
  ]);
  const { notify } = useToast();

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [status, setStatus] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [qOrderNo, setQOrderNo] = useState("");
  const [tickNow, setTickNow] = useState(Date.now());
  const reloadInFlightRef = useRef(false);
  const statusSelectValue = status || "__ALL_STATUS__";
  const paymentMethodSelectValue = paymentMethod || "__ALL_PAYMENT__";

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

      const data = await apiFetch<{ orders: OrderRow[] }>(
        `/api/order-book?${params.toString()}`,
      );
      setOrders(data.orders);
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "注文一覧の取得に失敗しました",
      });
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
    },
  });

  const editNote = async (orderId: string, next: string) => {
    try {
      await apiFetch(`/api/orders/${orderId}/note`, {
        method: "PATCH",
        body: JSON.stringify({ specialNote: next }),
      });
      notify({ level: "success", message: "備考を更新しました" });
      await reload();
    } catch (e) {
      notify({
        level: "error",
        message: e instanceof Error ? e.message : "備考更新に失敗しました",
      });
    }
  };

  const reprint = async (orderId: string) => {
    try {
      const data = await apiFetch<{ printed: boolean; receiptPreview: string }>(
        `/api/orders/${orderId}/receipt`,
        {
          method: "POST",
        },
      );
      notify({
        level: "success",
        message: data.printed
          ? "レシートを印刷しました"
          : `レシートプレビュー: ${data.receiptPreview}`,
        durationMs: data.printed ? 3500 : 9000,
      });
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "レシート再印刷に失敗しました",
      });
    }
  };

  const rows = useMemo(() => {
    return orders.map((order) => {
      const createdMs = new Date(order.createdAt).getTime();
      const completedMs = order.completedAt
        ? new Date(order.completedAt).getTime()
        : null;
      const elapsedSec =
        order.orderStatus === "COMPLETED" && completedMs
          ? Math.max(0, Math.floor((completedMs - createdMs) / 1000))
          : Math.max(0, Math.floor((tickNow - createdMs) / 1000));

      return {
        ...order,
        elapsedSec,
        bundledItems: bundleItems(order.items),
        elapsedLabel:
          order.orderStatus === "COMPLETED"
            ? `提供完了まで ${formatMss(elapsedSec)}`
            : `注文から ${formatMss(elapsedSec)}`,
      };
    });
  }, [orders, tickNow]);

  if (loading || !session) {
    return <LoadingScreen />;
  }

  const canEditNote =
    session.actor.actorType === "POS" || session.actor.actorType === "ADMIN";

  return (
    <>
      <TerminalBanner
        actorId={session.actor.actorId}
        actorType={session.actor.actorType}
        actorLabel={session.actor.label}
        offlineActors={session.offlineActors}
      />
      <DashboardShell
        eyebrow="ORDER BOOK"
        title="オーダーブック"
        // subtitle="注文進行と決済状態を時系列で追跡"
      >
        <div>
          <div className="row between wrap" style={{ marginBottom: 12 }}>
            {/* <h1 style={{ margin: 0 }}>オーダーブック</h1> */}
            <div className="row wrap">
              <Link
                href={routeByActorType(session.actor.actorType)}
                className="btn-link ghost-btn"
              >
                戻る
              </Link>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void reload()}
              >
                更新
              </button>
              <a
                href="/api/order-book/export"
                className="btn-link ghost-btn"
              >
                CSV出力 (注文別)
              </a>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="row wrap">
              <Input
                placeholder="注文番号"
                value={qOrderNo}
                onChange={(e) => setQOrderNo(e.target.value)}
                style={{ maxWidth: 120 }}
              />
              <div style={{ maxWidth: 220, width: "100%" }}>
                <Select
                  value={statusSelectValue}
                  onValueChange={(v) =>
                    setStatus(v === "__ALL_STATUS__" ? "" : v)
                  }
                >
                  <SelectTrigger className="bg-background text-foreground">
                    <SelectValue placeholder="状態: すべて" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__ALL_STATUS__">状態: すべて</SelectItem>
                    <SelectItem value="PENDING">
                      {labelOf(ORDER_STATUS_LABEL, "PENDING")}
                    </SelectItem>
                    <SelectItem value="PREPARING">
                      {labelOf(ORDER_STATUS_LABEL, "PREPARING")}
                    </SelectItem>
                    <SelectItem value="AWAITING_SERVING">
                      {labelOf(ORDER_STATUS_LABEL, "AWAITING_SERVING")}
                    </SelectItem>
                    <SelectItem value="COMPLETED">
                      {labelOf(ORDER_STATUS_LABEL, "COMPLETED")}
                    </SelectItem>
                    <SelectItem value="CANCELED">
                      {labelOf(ORDER_STATUS_LABEL, "CANCELED")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div style={{ maxWidth: 220, width: "100%" }}>
                <Select
                  value={paymentMethodSelectValue}
                  onValueChange={(v) =>
                    setPaymentMethod(v === "__ALL_PAYMENT__" ? "" : v)
                  }
                >
                  <SelectTrigger className="bg-background text-foreground">
                    <SelectValue placeholder="決済: すべて" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__ALL_PAYMENT__">
                      決済: すべて
                    </SelectItem>
                    <SelectItem value="CASH">
                      {labelOf(PAYMENT_METHOD_LABEL, "CASH")}
                    </SelectItem>
                    <SelectItem value="SQUARE">
                      {labelOf(PAYMENT_METHOD_LABEL, "SQUARE")}
                    </SelectItem>
                    <SelectItem value="PAYMENT_SKIPPED">
                      {labelOf(PAYMENT_METHOD_LABEL, "PAYMENT_SKIPPED")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="list">
            {rows.map((order) => (
              <article
                key={order.id}
                className={`card ${orderAgeClass(order.orderStatus, order.elapsedSec)}`}
              >
                <div className="row between wrap">
                  <div>
                    <strong>注文 #{order.orderNo}</strong>
                    <div className="muted">
                      {labelOf(FULFILLMENT_LABEL, order.fulfillmentType)}
                      {order.tableNo
                        ? ` / テーブル ${order.tableNo}`
                        : ""} /{" "}
                      {labelOf(PAYMENT_METHOD_LABEL, order.paymentMethod)}
                    </div>
                    <div className="muted">{order.elapsedLabel}</div>
                  </div>
                  <div className="row wrap">
                    <span
                      className={`badge order-status-badge ${orderStatusClass(order.orderStatus)}`}
                    >
                      {labelOf(ORDER_STATUS_LABEL, order.orderStatus)}
                    </span>
                    <span className="badge">
                      {labelOf(PAYMENT_STATUS_LABEL, order.paymentStatus)}
                    </span>
                    <strong>{fmtJpy(order.totalPriceJpy)}</strong>
                  </div>
                </div>

                {order.specialNote && (
                  <div className="notice" style={{ marginTop: 8 }}>
                    備考: {order.specialNote}
                  </div>
                )}
                <div className="muted" style={{ marginTop: 8 }}>
                  年齢構成:
                  {AGE_GROUPS.map((group) => (
                    <span key={group.key} style={{ marginLeft: 8 }}>
                      {group.label} {order.ageGroupCounts[group.key] ?? 0}
                    </span>
                  ))}
                </div>

                <div className="list" style={{ marginTop: 10 }}>
                  {order.bundledItems.map((item) => (
                    <div key={item.key} className="list-item row between wrap">
                      <div>
                        <strong>{item.count}x</strong> {item.name}
                        <span
                          className={`badge ${item.status === "READY" ? "ready" : item.status === "SERVED" ? "served" : "queued"}`}
                          style={{ marginLeft: 8 }}
                        >
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
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => reprint(order.id)}
                  >
                    レシート再印刷
                  </button>
                  {canEditNote &&
                    order.orderStatus !== "COMPLETED" &&
                    order.orderStatus !== "CANCELED" && (
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
        </div>
      </DashboardShell>
    </>
  );
}
