"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
import { orderAgeTone } from "@/lib/order-age";
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
import { CancelCashOrder } from "@/components/cancel-cash-order";
import { canCancelCashOrder } from "@/lib/domain/cash-cancel-eligibility";
import { ReceiptPrintDialog } from "@/components/receipt-print-dialog";
import type { ReceiptPrintTarget } from "@/lib/receipt/types";

type OrderRow = {
  id: string;
  orderNo: number;
  createdAt: string;
  confirmedAt: string | null;
  lastCalledAt: string | null;
  completedAt: string | null;
  fulfillmentType: "DINE_IN" | "TAKEOUT";
  tableNo: number | null;
  ageGroupCounts: AgeGroupCounts;
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  failedAt: string | null;
  failureReasonType: string | null;
  failureReasonText: string | null;
  totalPriceJpy: number;
  specialNote: string | null;
  lastMutationVersion: number;
  items: Array<{
    id: string;
    menuId: string;
    name: string;
    unitPriceJpy: number;
    status: string;
    kitchenId: string | null;
  }>;
};

type MenuCountRow = {
  menuId: string;
  name: string;
  ordered: number;
  queued: number;
  totalSoldPriceJpy: number;
  cap: number | null;
  toCap: number | null;
};

type MenuTotals = {
  ordered: number;
  queued: number;
  totalSoldPriceJpy: number;
};

type PaymentIncidentRow = {
  id: string;
  orderId: string;
  orderNo: number;
  responsiblePosActorId: string;
  messageJa: string;
  createdAt: string;
};

type BundledItem = {
  key: string;
  name: string;
  unitPriceJpy: number;
  status: string;
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
    case "FAILED":
      return "order-status-failed";
    case "CANCELED":
      return "order-status-canceled";
    default:
      return "";
  }
}

function orderAgeClass(
  orderStatus: string,
  paymentStatus: string,
  elapsedSec: number,
) {
  if (
    orderStatus === "COMPLETED" ||
    orderStatus === "FAILED" ||
    orderStatus === "CANCELED"
  ) {
    return "";
  }
  if (paymentStatus === "AWAITING") {
    return "";
  }
  return `order-age-${orderAgeTone(elapsedSec)}`;
}

function bundleItems(items: OrderRow["items"]): BundledItem[] {
  const bucket = new Map<string, BundledItem>();

  for (const item of items) {
    const key = `${item.name}::${item.status}::${item.unitPriceJpy}`;
    const existing = bucket.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }

    bucket.set(key, {
      key,
      name: item.name,
      unitPriceJpy: item.unitPriceJpy,
      status: item.status,
      count: 1,
    });
  }

  return [...bucket.values()];
}

function failureReasonLabel(reasonType: string | null) {
  switch ((reasonType ?? "").toUpperCase()) {
    case "TIMEOUT":
      return "タイムアウト";
    case "FAILURE_CALLBACK":
      return "失敗コールバック";
    case "MANUAL_CANCEL":
      return "手動キャンセル";
    case "MANUAL_FAILURE":
      return "手動失敗処理";
    default:
      return "不明";
  }
}

const TOKYO_TZ = "Asia/Tokyo";
const TOKYO_DAY_MS = 24 * 60 * 60 * 1000;

function tokyoDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function addDaysToDateKey(dateKey: string, days: number) {
  const next = new Date(`${dateKey}T00:00:00+09:00`);
  next.setUTCDate(next.getUTCDate() + days);
  return tokyoDateKey(next);
}

function tokyoDayRangeIso(dateKey: string) {
  const start = new Date(`${dateKey}T00:00:00+09:00`);
  return {
    from: start.toISOString(),
    to: new Date(start.getTime() + TOKYO_DAY_MS - 1).toISOString(),
  };
}

function formatDateLabel(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+09:00`).toLocaleDateString("ja-JP", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
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
  const [menuCounts, setMenuCounts] = useState<MenuCountRow[]>([]);
  const [menuTotals, setMenuTotals] = useState<MenuTotals>({
    ordered: 0,
    queued: 0,
    totalSoldPriceJpy: 0,
  });
  const [incidents, setIncidents] = useState<PaymentIncidentRow[]>([]);
  const [status, setStatus] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [qOrderNo, setQOrderNo] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => tokyoDateKey());
  const [tickNow, setTickNow] = useState(Date.now());
  const [receiptPrintTarget, setReceiptPrintTarget] =
    useState<ReceiptPrintTarget | null>(null);
  const reloadInFlightRef = useRef(false);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const queuedReloadRef = useRef(false);
  const statusSelectValue = status || "__ALL_STATUS__";
  const paymentMethodSelectValue = paymentMethod || "__ALL_PAYMENT__";

  const reload = async () => {
    if (reloadInFlightRef.current) {
      queuedReloadRef.current = true;
      return;
    }
    reloadInFlightRef.current = true;

    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (paymentMethod) params.set("paymentMethod", paymentMethod);
      if (qOrderNo) params.set("orderNo", qOrderNo);
      const range = tokyoDayRangeIso(selectedDate);
      params.set("from", range.from);
      params.set("to", range.to);

      const data = await apiFetch<{
        orders: OrderRow[];
        menuCounts: MenuCountRow[];
        menuTotals: MenuTotals;
        incidents: PaymentIncidentRow[];
      }>(`/api/order-book?${params.toString()}`);
      setOrders(data.orders);
      setMenuCounts(data.menuCounts);
      setMenuTotals(
        data.menuTotals ?? {
          ordered: 0,
          queued: 0,
          totalSoldPriceJpy: 0,
        },
      );
      setIncidents(data.incidents ?? []);
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "注文一覧の取得に失敗しました",
      });
    } finally {
      reloadInFlightRef.current = false;
      if (queuedReloadRef.current) {
        queuedReloadRef.current = false;
        void reload();
      }
    }
  };

  useEffect(() => {
    if (!session) return;
    void reload();
  }, [session, status, paymentMethod, qOrderNo, selectedDate]);

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

  const reprint = (order: OrderRow) => {
    setReceiptPrintTarget({ id: order.id, orderNo: order.orderNo });
  };
  const manualClose = async (order: OrderRow) => {
    if (closingRef.current) return;
    if (!window.confirm(`注文 #${order.orderNo} の残りの商品をすべて提供済みにしますか？（手動完了として記録されます）`)) return;
    closingRef.current=true;setClosing(true);
    try {
      await apiFetch(`/api/orders/${order.id}/manual-close`,{method:"POST",body:JSON.stringify({expectedVersion:order.lastMutationVersion,confirm:true})});
      notify({level:"success",message:`注文 #${order.orderNo} を手動完了しました`});
    }catch(error){notify({level:"error",message:error instanceof Error?error.message:"手動完了に失敗しました"});}
    finally{await reload();closingRef.current=false;setClosing(false);}
  };

  const rows = useMemo(() => {
    return orders.map((order) => {
      const createdMs = new Date(order.createdAt).getTime();
      const elapsedSec = Math.max(0, Math.floor((tickNow - createdMs) / 1000));
      const confirmedLabel = order.confirmedAt
        ? new Date(order.confirmedAt).toLocaleString("ja-JP", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : "-";
      const failedLabel = order.failedAt
        ? new Date(order.failedAt).toLocaleString("ja-JP", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : "-";
      const failureReason =
        order.failureReasonText && order.failureReasonText.trim().length > 0
          ? `${failureReasonLabel(order.failureReasonType)} / ${order.failureReasonText}`
          : failureReasonLabel(order.failureReasonType);

      return {
        ...order,
        elapsedSec,
        failureReason,
        bundledItems: bundleItems(order.items),
        elapsedLabel:
          order.orderStatus === "COMPLETED"
            ? `注文確定時刻 ${confirmedLabel}`
            : order.orderStatus === "FAILED"
              ? `失敗時刻 ${failedLabel}`
              : order.orderStatus === "CANCELED"
                ? `取消時刻 ${failedLabel}`
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
              <Link href={{ pathname: "/sales" }} className="btn-link ghost-btn">
                売上・待ち時間
              </Link>
              <a href="/api/order-book/export" className="btn-link ghost-btn">
                CSV出力
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
                    <SelectItem value="CANCELED">取消</SelectItem>
                    <SelectItem value="FAILED">
                      {labelOf(ORDER_STATUS_LABEL, "FAILED")}
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

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="row between wrap" style={{ marginBottom: 8 }}>
              <div>
                <strong>メニュー別 日別集計</strong>
                <div className="muted">{formatDateLabel(selectedDate)}</div>
              </div>
              <div className="order-book-day-switcher">
                <button
                  type="button"
                  className="ghost-btn order-book-day-arrow"
                  aria-label="前日"
                  onClick={() =>
                    setSelectedDate((value) => addDaysToDateKey(value, -1))
                  }
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
                <Input
                  aria-label="集計日"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) {
                      setSelectedDate(e.target.value);
                    }
                  }}
                  className="order-book-day-input"
                />
                <button
                  type="button"
                  className="ghost-btn order-book-day-arrow"
                  aria-label="翌日"
                  onClick={() =>
                    setSelectedDate((value) => addDaysToDateKey(value, 1))
                  }
                >
                  <ChevronRight aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ghost-btn order-book-today-btn"
                  onClick={() => setSelectedDate(tokyoDateKey())}
                >
                  今日
                </button>
              </div>
            </div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>メニュー</th>
                    <th>注文済み</th>
                    <th>売上</th>
                    <th>(うち未提供)</th>
                    <th>上限</th>
                    <th>上限まで残り</th>
                  </tr>
                </thead>
                <tbody>
                  {menuCounts.map((item) => (
                    <tr key={item.menuId}>
                      <td>{item.name}</td>
                      <td>{item.ordered}</td>
                      <td>{fmtJpy(item.totalSoldPriceJpy)}</td>
                      <td>{item.queued}</td>
                      <td>{item.cap == null ? "∞" : item.cap}</td>
                      <td>{item.toCap == null ? "-" : item.toCap}</td>
                    </tr>
                  ))}
                  {menuCounts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        対象データがありません
                      </td>
                    </tr>
                  ) : null}
                </tbody>
                {menuCounts.length > 0 ? (
                  <tfoot>
                    <tr className="order-book-total-row">
                      <th>合計</th>
                      <th>{menuTotals.ordered}</th>
                      <th>{fmtJpy(menuTotals.totalSoldPriceJpy)}</th>
                      <th>{menuTotals.queued}</th>
                      <th>-</th>
                      <th>-</th>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>

          {incidents.length > 0 && (
            <div
              className="card"
              style={{
                marginBottom: 14,
                borderColor: "#dd9494",
                background: "#fff1f1",
              }}
            >
              <div className="row between wrap" style={{ marginBottom: 8 }}>
                <strong style={{ color: "#7f1d1d" }}>
                  Square決済状態が異常な注文
                </strong>
              </div>
              <div className="list">
                {incidents.map((incident) => (
                  <div
                    key={incident.id}
                    className="notice error"
                    style={{ margin: 0 }}
                  >
                    <div style={{ color: "#7f1d1d", fontWeight: 700 }}>
                      注文 #{incident.orderNo}
                    </div>
                    <div>{incident.messageJa}</div>
                    <div className="row between wrap" style={{ marginTop: 8 }}>
                      <span className="muted">
                        担当POS: {incident.responsiblePosActorId} /{" "}
                        {new Date(incident.createdAt).toLocaleString("ja-JP")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="list">
            {rows.map((order) => (
              <article
                key={order.id}
                className={`card ${orderAgeClass(order.orderStatus, order.paymentStatus, order.elapsedSec)}`}
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
                {["FAILED", "CANCELED"].includes(order.orderStatus) && (
                  <div className="notice error" style={{ marginTop: 8 }}>
                    {order.orderStatus === "CANCELED" ? "取消理由" : "失敗理由"}: {order.failureReason}
                  </div>
                )}
                <div className="muted" style={{ marginTop: 8 }}>
                  {"年齢構成: "}
                  <span>
                    {AGE_GROUPS.map(
                      (group) =>
                        group.label +
                        " × " +
                        (order.ageGroupCounts[group.key] ?? 0),
                    ).join(" / ")}
                  </span>
                </div>

                <div className="list" style={{ marginTop: 10 }}>
                  {order.bundledItems.map((item) => (
                    <div key={item.key} className="list-item row between wrap">
                      <div>
                        <strong>{item.count} × </strong> {item.name}
                        <span
                          className={`badge ${item.status === "READY" ? "ready" : item.status === "SERVED" ? "served" : "queued"}`}
                          style={{ marginLeft: 8 }}
                        >
                          {labelOf(ORDER_ITEM_STATUS_LABEL, item.status)}
                        </span>
                        <span className="muted" style={{ marginLeft: 8 }}>
                          {fmtJpy(item.unitPriceJpy)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="row wrap" style={{ marginTop: 10 }}>
                  {canEditNote && canCancelCashOrder(order) && (
                    <CancelCashOrder order={order} onCanceled={() => {
                      setReceiptPrintTarget(null);
                      notify({ level: "success", message: `注文 #${order.orderNo} を取り消しました` });
                      void reload();
                    }} />
                  )}
                  {order.confirmedAt && ["PAID","SKIPPED"].includes(order.paymentStatus) && !["COMPLETED","FAILED","CANCELED"].includes(order.orderStatus) && order.items.length>0 && order.items.every(item=>item.status!=="CANCELED") && <button type="button" className="ghost-btn" disabled={closing} onClick={()=>void manualClose(order)}>手動完了</button>}
                  {session.actor.actorType === "WAITER" && order.confirmedAt && !["FAILED", "CANCELED"].includes(order.orderStatus) && (
                    <button type="button" className="order-call-btn" aria-pressed={Boolean(order.lastCalledAt)} onClick={async () => {
                      const cancel = Boolean(order.lastCalledAt);
                      if (!window.confirm(`オーダー #${order.orderNo} ${cancel ? "の呼び出しを解除しますか？" : "を呼び出しますか？"}`)) return;
                      try {
                        await apiFetch("/api/counter/call", { method: "POST", body: JSON.stringify({ orderId: order.id, action: cancel ? "cancel" : "call", confirm: true, idempotencyKey: crypto.randomUUID() }) });
                        notify({ level: "success", message: `オーダー #${order.orderNo} ${cancel ? "の呼び出しを解除しました" : "を呼び出しました"}` });
                        await reload();
                      } catch (e) {
                        notify({ level: "error", message: e instanceof Error ? e.message : "呼び出しに失敗しました" });
                      }
                    }}>{order.lastCalledAt ? "呼び出し解除" : "呼び出す"}</button>
                  )}
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => reprint(order)}
                    disabled={
                      (order.paymentStatus !== "PAID" &&
                        order.paymentStatus !== "SKIPPED") ||
                      order.orderStatus === "FAILED" ||
                      order.orderStatus === "CANCELED"
                    }
                  >
                    レシート再印刷
                  </button>
                  {canEditNote && (
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
      <ReceiptPrintDialog
        target={receiptPrintTarget}
        onClose={() => setReceiptPrintTarget(null)}
      />
    </>
  );
}
