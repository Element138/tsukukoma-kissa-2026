"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";

type OrderRow = {
  id: string;
  orderNo: number;
  createdAt: string;
  fulfillmentType: "DINE_IN" | "TAKEOUT";
  tableNo: number | null;
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  totalPriceJpy: number;
  specialNote: string | null;
  hasInactiveKitchenQueuedItem: boolean;
  items: Array<{
    id: string;
    name: string;
    status: string;
    kitchenId: string | null;
    kitchenName?: string;
    kitchenInactive: boolean;
  }>;
};

export default function OrderBookPage() {
  const { loading, session } = useSession(["POS", "KITCHEN", "WAITER", "ADMIN"]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [status, setStatus] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [qOrderNo, setQOrderNo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      reloadInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!session) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status, paymentMethod, qOrderNo]);

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
      setMessage("Special note updated");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update note");
    }
  };

  const reprint = async (orderId: string) => {
    try {
      const data = await apiFetch<{ printed: boolean; receiptPreview: string }>(`/api/orders/${orderId}/receipt`, {
        method: "POST"
      });
      setMessage(data.printed ? "Reprint request sent" : `Receipt preview:\n${data.receiptPreview}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reprint receipt");
    }
  };

  if (loading || !session) {
    return <main>Loading...</main>;
  }

  const canEditNote = session.actor.actorType === "POS" || session.actor.actorType === "ADMIN";

  return (
    <>
      <TerminalBanner
        actorId={session.actor.actorId}
        actorType={session.actor.actorType}
        actorLabel={session.actor.label}
        offlineActors={session.offlineActors}
        inactiveKitchenWarnings={session.inactiveKitchenQueuedItems.map((x) => ({ kitchenName: x.kitchenName }))}
      />
      <main>
        <div className="row between wrap" style={{ marginBottom: 12 }}>
          <h1 style={{ margin: 0 }}>Order Book</h1>
          <div className="row wrap">
            <Link href="/order-book">
              <button className="ghost-btn">Refresh</button>
            </Link>
            <a href="/api/order-book/export">
              <button className="ghost-btn">CSV Export</button>
            </a>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row wrap">
            <input placeholder="Order No" value={qOrderNo} onChange={(e) => setQOrderNo(e.target.value)} style={{ maxWidth: 120 }} />
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">status: all</option>
              <option value="PENDING">PENDING</option>
              <option value="PREPARING">PREPARING</option>
              <option value="AWAITING_SERVING">AWAITING_SERVING</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="CANCELED">CANCELED</option>
            </select>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">payment: all</option>
              <option value="CASH">CASH</option>
              <option value="SQUARE">SQUARE</option>
              <option value="PAYMENT_SKIPPED">PAYMENT_SKIPPED</option>
            </select>
          </div>
        </div>

        {error && <div className="notice error">{error}</div>}
        {message && <div className="notice ok" style={{ whiteSpace: "pre-wrap" }}>{message}</div>}

        <div className="list">
          {orders.map((order) => (
            <article key={order.id} className="card">
              <div className="row between wrap">
                <div>
                  <strong>Order #{order.orderNo}</strong>
                  <div className="muted">
                    {order.fulfillmentType}
                    {order.tableNo ? ` / table ${order.tableNo}` : ""} / {order.paymentMethod}
                  </div>
                </div>
                <div className="row wrap">
                  <span className="badge">{order.orderStatus}</span>
                  <span className="badge">{order.paymentStatus}</span>
                  <strong>{fmtJpy(order.totalPriceJpy)}</strong>
                </div>
              </div>

              {order.hasInactiveKitchenQueuedItem && (
                <div className="notice error">This order contains queued items assigned to an inactive kitchen.</div>
              )}

              <div className="list" style={{ marginTop: 10 }}>
                {order.items.map((item) => (
                  <div key={item.id} className="list-item row between wrap">
                    <div>
                      {item.name}
                      <span className={`badge ${item.status === "READY" ? "ready" : item.status === "SERVED" ? "served" : "queued"}`} style={{ marginLeft: 8 }}>
                        {item.status}
                      </span>
                      {item.kitchenName && (
                        <span className="muted" style={{ marginLeft: 8 }}>
                          {item.kitchenName}
                        </span>
                      )}
                    </div>
                    {item.kitchenInactive && <span className="notice error">kitchen inactive</span>}
                  </div>
                ))}
              </div>

              <div className="row wrap" style={{ marginTop: 10 }}>
                <button className="ghost-btn" onClick={() => reprint(order.id)}>Reprint Receipt</button>
                {canEditNote && order.orderStatus !== "COMPLETED" && order.orderStatus !== "CANCELED" && (
                  <button
                    className="ghost-btn"
                    onClick={() => {
                      const next = prompt("Special note", order.specialNote ?? "");
                      if (next !== null) {
                        editNote(order.id, next);
                      }
                    }}
                  >
                    Edit Note
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


