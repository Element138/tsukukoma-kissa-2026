"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { Card, SectionTitle } from "@/components/ui";
import { TerminalBanner } from "@/components/terminal-banner";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { useToast } from "@/components/toast";

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
  const { notify } = useToast();

  const [dineInItems, setDineInItems] = useState<DineInItem[]>([]);
  const [takeoutOrders, setTakeoutOrders] = useState<TakeoutOrder[]>([]);
  const reloadInFlightRef = useRef(false);

  const reload = async () => {
    if (reloadInFlightRef.current) {
      return;
    }
    reloadInFlightRef.current = true;

    try {
      const data = await apiFetch<{ dineInItems: DineInItem[]; takeoutOrders: TakeoutOrder[] }>("/api/waiter/targets");
      setDineInItems(data.dineInItems);
      setTakeoutOrders(data.takeoutOrders);
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "配膳データの取得に失敗しました" });
    } finally {
      reloadInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!session) {
      return;
    }
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useRealtimeSubscription({
    enabled: Boolean(session),
    channels: ["orders", "waiter"],
    onEvent: () => {
      void reload();
    },
    onResync: () => {
      void reload();
    }
  });

  const serveItem = async (orderItemId: string) => {
    try {
      await apiFetch("/api/waiter/serve-item", {
        method: "POST",
        body: JSON.stringify({ orderItemId, expectedItemStatus: "READY" })
      });
      notify({ level: "success", message: "提供済みに更新しました" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "提供処理に失敗しました" });
    }
  };

  const serveOrder = async (orderId: string) => {
    try {
      await apiFetch("/api/waiter/serve-order", {
        method: "POST",
        body: JSON.stringify({ orderId })
      });
      notify({ level: "success", message: "持ち帰り注文を提供済みにしました" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "提供処理に失敗しました" });
    }
  };

  const undo = async () => {
    try {
      const data = await apiFetch<{ result: { revertedItemCount: number } }>("/api/undo", {
        method: "POST",
        body: JSON.stringify({ confirm: true })
      });
      notify({ level: "success", message: `取り消しを実行しました（${data.result.revertedItemCount}品）` });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "取り消しに失敗しました" });
    }
  };

  if (loading || !session) {
    return <main>読み込み中...</main>;
  }

  return (
    <>
      <TerminalBanner
        actorId={session.actor.actorId}
        actorType={session.actor.actorType}
        actorLabel={session.actor.label}
        offlineActors={session.offlineActors}
        inactiveKitchenWarnings={session.inactiveKitchenQueuedItems.map((x) => ({ kitchenName: x.kitchenName }))}
      />
      <main className="grid two">
        <Card>
          <SectionTitle>店内提供待ち</SectionTitle>
          <div className="row wrap" style={{ marginBottom: 10 }}>
            <button className="ghost-btn" onClick={undo}>
              取り消し
            </button>
            <Link href="/order-book">
              <button className="ghost-btn">オーダーブック</button>
            </Link>
          </div>

          <div className="list">
            {dineInItems.length === 0 && <div className="muted">提供待ちはありません</div>}
            {dineInItems.map((item) => (
              <div key={item.id} className="list-item">
                <div className="row between wrap">
                  <div>
                    <strong>{item.name}</strong>
                    <div className="muted">
                      テーブル {item.tableNo ?? "-"} / 注文 #{item.orderNo}
                    </div>
                  </div>
                  <button onClick={() => serveItem(item.id)}>提供済みにする</button>
                </div>
                {item.specialNote && <div className="notice" style={{ marginTop: 8 }}>{item.specialNote}</div>}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>持ち帰り（提供待ち）</SectionTitle>
          <div className="list">
            {takeoutOrders.length === 0 && <div className="muted">提供待ちの持ち帰り注文はありません</div>}
            {takeoutOrders.map((order) => (
              <div key={order.id} className="list-item">
                <div className="row between wrap">
                  <div>
                    <strong>注文 #{order.orderNo}</strong>
                    <div className="muted">{order.itemCount} ?</div>
                  </div>
                  <button onClick={() => serveOrder(order.id)}>まとめて提供済みにする</button>
                </div>
                <div className="muted" style={{ marginTop: 8 }}>
                  {order.itemNames.join(" / ")}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </main>
    </>
  );
}