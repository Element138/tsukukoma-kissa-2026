"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { Card, SectionTitle } from "@/components/ui";
import { TerminalBanner } from "@/components/terminal-banner";

type DineInItem = {
  id: string;
  name: string;
  orderId: string;
  orderNo: number;
  tableNo: number | null;
  readyAt: string;
  specialNote: string | null;
};

type TakeoutOrder = {
  id: string;
  orderNo: number;
  totalPriceJpy: number;
  itemCount: number;
  itemNames: string[];
};

export default function WaiterPage() {
  const { loading, session } = useSession(["WAITER"]);
  const [dineInItems, setDineInItems] = useState<DineInItem[]>([]);
  const [takeoutOrders, setTakeoutOrders] = useState<TakeoutOrder[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const data = await apiFetch<{ dineInItems: DineInItem[]; takeoutOrders: TakeoutOrder[] }>("/api/waiter/targets");
      setDineInItems(data.dineInItems);
      setTakeoutOrders(data.takeoutOrders);
    } catch (e) {
      setError(e instanceof Error ? e.message : "read failed");
    }
  };

  useEffect(() => {
    if (!session) {
      return;
    }
    reload();
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [session]);

  const serveItem = async (orderItemId: string) => {
    try {
      await apiFetch("/api/waiter/serve-item", {
        method: "POST",
        body: JSON.stringify({ orderItemId, expectedItemStatus: "READY" })
      });
      setMessage("item served を記録しました");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "serve item failed");
    }
  };

  const serveOrder = async (orderId: string) => {
    try {
      await apiFetch("/api/waiter/serve-order", {
        method: "POST",
        body: JSON.stringify({ orderId })
      });
      setMessage("takeout order served を記録しました");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "serve order failed");
    }
  };

  const undo = async () => {
    try {
      await apiFetch("/api/undo", {
        method: "POST",
        body: JSON.stringify({ confirm: true })
      });
      setMessage("Undoを実行しました");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "undo failed");
    }
  };

  if (loading || !session) {
    return <main>Loading...</main>;
  }

  return (
    <>
      <TerminalBanner
        actorId={session.actor.actorId}
        actorType={session.actor.actorType}
        actorLabel={session.actor.label}
        offlineActors={session.offlineActors}
        inactiveLineWarnings={session.inactiveLineQueuedItems.map((x) => ({ lineName: x.lineName }))}
      />
      <main className="grid two">
        <Card>
          <SectionTitle>Dine-in Ready Items</SectionTitle>
          <div className="row wrap" style={{ marginBottom: 10 }}>
            <button className="ghost-btn" onClick={undo}>
              Undo Last Action
            </button>
            <Link href="/order-book">
              <button className="ghost-btn">Order Book</button>
            </Link>
          </div>

          <div className="list">
            {dineInItems.length === 0 && <div className="muted">ready item はありません</div>}
            {dineInItems.map((item) => (
              <div key={item.id} className="list-item">
                <div className="row between wrap">
                  <div>
                    <strong>{item.name}</strong>
                    <div className="muted">
                      table {item.tableNo ?? "-"} / order #{item.orderNo}
                    </div>
                  </div>
                  <button onClick={() => serveItem(item.id)}>Serve</button>
                </div>
                {item.specialNote && <div className="notice" style={{ marginTop: 8 }}>{item.specialNote}</div>}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>Takeout Orders (All Ready)</SectionTitle>
          <div className="list">
            {takeoutOrders.length === 0 && <div className="muted">受け渡し可能なtakeoutはありません</div>}
            {takeoutOrders.map((order) => (
              <div key={order.id} className="list-item">
                <div className="row between wrap">
                  <div>
                    <strong>Order #{order.orderNo}</strong>
                    <div className="muted">{order.itemCount} items</div>
                  </div>
                  <button onClick={() => serveOrder(order.id)}>Serve All</button>
                </div>
                <div className="muted" style={{ marginTop: 8 }}>
                  {order.itemNames.join(" / ")}
                </div>
              </div>
            ))}
          </div>

          {message && <div className="notice ok">{message}</div>}
          {error && <div className="notice error">{error}</div>}
        </Card>
      </main>
    </>
  );
}


