"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { Card, SectionTitle } from "@/components/ui";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { useToast } from "@/components/toast";

type DineInOrder = {
  id: string;
  orderNo: number;
  tableNo: number | null;
  createdAt: string;
  specialNote: string | null;
  readyItems: Array<{ id: string; name: string }>;
  readyItemCount: number;
};

type TakeoutOrder = {
  id: string;
  orderNo: number;
  createdAt: string;
  totalPriceJpy: number;
  itemCount: number;
  itemNames: string[];
  readyItemCount: number;
};

function formatMss(totalSeconds: number) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export default function WaiterPage() {
  const { loading, session } = useSession(["WAITER"]);
  const { notify } = useToast();

  const [dineInOrders, setDineInOrders] = useState<DineInOrder[]>([]);
  const [takeoutOrders, setTakeoutOrders] = useState<TakeoutOrder[]>([]);
  const [tickNow, setTickNow] = useState(Date.now());
  const reloadInFlightRef = useRef(false);

  const reload = async () => {
    if (reloadInFlightRef.current) {
      return;
    }
    reloadInFlightRef.current = true;

    try {
      const data = await apiFetch<{ dineInOrders: DineInOrder[]; takeoutOrders: TakeoutOrder[] }>("/api/waiter/targets");
      setDineInOrders(data.dineInOrders);
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
  }, [session]);

  useEffect(() => {
    const timer = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

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

  const dineInTiles = useMemo(
    () =>
      dineInOrders.map((order) => {
        const createdMs = new Date(order.createdAt).getTime();
        return {
          ...order,
          elapsedSinceOrdered: formatMss((tickNow - createdMs) / 1000)
        };
      }),
    [dineInOrders, tickNow]
  );

  const takeoutTiles = useMemo(
    () =>
      takeoutOrders.map((order) => {
        const createdMs = new Date(order.createdAt).getTime();
        return {
          ...order,
          elapsedSinceOrdered: formatMss((tickNow - createdMs) / 1000)
        };
      }),
    [takeoutOrders, tickNow]
  );

  const dineInTableReadySummary = useMemo(() => {
    const summary = new Map<number, { orderIds: string[]; readyCount: number }>();
    for (const order of dineInOrders) {
      if (order.tableNo == null) {
        continue;
      }
      const current = summary.get(order.tableNo) ?? { orderIds: [], readyCount: 0 };
      current.orderIds.push(order.id);
      current.readyCount += order.readyItems.length;
      summary.set(order.tableNo, current);
    }
    return summary;
  }, [dineInOrders]);

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
      notify({ level: "success", message: "まとめて提供済みに更新しました" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "提供処理に失敗しました" });
    }
  };

  const serveTable = async (order: DineInOrder) => {
    const orderIds =
      order.tableNo != null
        ? dineInTableReadySummary.get(order.tableNo)?.orderIds ?? [order.id]
        : [order.id];

    try {
      for (const orderId of orderIds) {
        await apiFetch("/api/waiter/serve-order", {
          method: "POST",
          body: JSON.stringify({ orderId })
        });
      }
      notify({ level: "success", message: "テーブル分をまとめて提供済みに更新しました" });
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
      notify({ level: "success", message: `取り消しました（${data.result.revertedItemCount} 件）` });
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
      <TerminalBanner actorId={session.actor.actorId} actorType={session.actor.actorType} actorLabel={session.actor.label} offlineActors={session.offlineActors} />
      <DashboardShell
        eyebrow="SERVICE FLOW"
        title="配膳ダッシュボード"
        subtitle="提供待ちとテーブル進行を見える化"
      >
        <div className="grid">
        <Card>
          <div className="row between wrap" style={{ marginBottom: 10 }}>
            <SectionTitle>配膳ビュー</SectionTitle>
            <div className="row wrap">
              <button type="button" className="ghost-btn" onClick={undo}>
                取り消し
              </button>
              <Link href="/order-book" className="btn-link ghost-btn">
                オーダーブック
              </Link>
            </div>
          </div>

          <h3 style={{ margin: "6px 0 10px" }}>店内</h3>
          <div className="waiter-tile-grid">
            {dineInTiles.length === 0 && <div className="muted">配膳待ちはありません</div>}
            {dineInTiles.map((order) => {
              const tableReadyCount =
                order.tableNo != null
                  ? dineInTableReadySummary.get(order.tableNo)?.readyCount ?? order.readyItems.length
                  : order.readyItems.length;

              return (
                <article key={order.id} className="waiter-tile">
                  <div className="row between wrap">
                    <strong>Table #{order.tableNo ?? "-"}</strong>
                    <span className="badge">注文 #{order.orderNo}</span>
                  </div>
                  <div className="muted">注文から {order.elapsedSinceOrdered}</div>

                  <div className="list" style={{ marginTop: 8 }}>
                    {order.readyItems.map((item) => (
                      <div key={item.id} className="list-item row between wrap" style={{ padding: "8px 10px" }}>
                        <span>{item.name}</span>
                        <button type="button" className="ghost-btn" onClick={() => serveItem(item.id)}>
                          個別提供
                        </button>
                      </div>
                    ))}
                  </div>

                  {tableReadyCount > 1 && (
                    <button type="button" style={{ marginTop: 8 }} onClick={() => serveTable(order)}>
                      テーブル分をまとめて提供済みにする
                    </button>
                  )}

                  {order.specialNote && <div className="notice" style={{ marginTop: 8 }}>{order.specialNote}</div>}
                </article>
              );
            })}
          </div>

          <h3 style={{ margin: "14px 0 10px" }}>持ち帰り</h3>
          <div className="waiter-tile-grid">
            {takeoutTiles.length === 0 && <div className="muted">配膳待ちの持ち帰り注文はありません</div>}
            {takeoutTiles.map((order) => (
              <article key={order.id} className="waiter-tile">
                <div className="row between wrap">
                  <strong>Order #{order.orderNo}</strong>
                  <span className="badge">{order.itemCount} 品</span>
                </div>
                <div className="muted">注文から {order.elapsedSinceOrdered}</div>
                <div className="muted" style={{ marginTop: 8 }}>
                  {order.itemNames.join(" / ")}
                </div>
                <button type="button" style={{ marginTop: 10 }} onClick={() => serveOrder(order.id)}>
                  まとめて提供済みにする
                </button>
              </article>
            ))}
          </div>
        </Card>
        </div>
      </DashboardShell>
    </>
  );
}

