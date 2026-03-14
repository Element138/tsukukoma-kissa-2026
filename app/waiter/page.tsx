"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { useToast } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { ACTOR_TYPE_LABEL, labelOf } from "@/lib/labels";

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

function queueTone(seconds: number) {
  if (seconds >= 600) {
    return "danger";
  }
  if (seconds >= 240) {
    return "warn";
  }
  return "safe";
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="section-title text-base font-semibold tracking-tight">
      {children}
    </h2>
  );
}

function bundleTakeoutItems(names: string[]) {
  const counts = new Map<string, number>();
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "ja"))
    .map(([name, count]) => `${count}x ${name}`);
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
      const data = await apiFetch<{
        dineInOrders: DineInOrder[];
        takeoutOrders: TakeoutOrder[];
      }>("/api/waiter/targets");
      setDineInOrders(data.dineInOrders);
      setTakeoutOrders(data.takeoutOrders);
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "配膳データの取得に失敗しました",
      });
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
    },
  });

  const dineInTiles = useMemo(
    () =>
      dineInOrders.map((order) => {
        const createdMs = new Date(order.createdAt).getTime();
        const elapsedSeconds = (tickNow - createdMs) / 1000;
        return {
          ...order,
          elapsedSeconds,
          elapsedSinceOrdered: formatMss(elapsedSeconds),
        };
      }),
    [dineInOrders, tickNow],
  );

  const takeoutTiles = useMemo(
    () =>
      takeoutOrders.map((order) => {
        const createdMs = new Date(order.createdAt).getTime();
        const elapsedSeconds = (tickNow - createdMs) / 1000;
        return {
          ...order,
          elapsedSeconds,
          elapsedSinceOrdered: formatMss(elapsedSeconds),
        };
      }),
    [takeoutOrders, tickNow],
  );

  const serveItem = async (orderItemId: string) => {
    try {
      await apiFetch("/api/waiter/serve-item", {
        method: "POST",
        body: JSON.stringify({ orderItemId, expectedItemStatus: "READY" }),
      });
      notify({ level: "success", message: "提供済みに更新しました" });
      await reload();
    } catch (e) {
      notify({
        level: "error",
        message: e instanceof Error ? e.message : "提供処理に失敗しました",
      });
    }
  };

  const serveOrder = async (orderId: string) => {
    try {
      await apiFetch("/api/waiter/serve-order", {
        method: "POST",
        body: JSON.stringify({ orderId }),
      });
      notify({ level: "success", message: "まとめて提供済みに更新しました" });
      await reload();
    } catch (e) {
      notify({
        level: "error",
        message: e instanceof Error ? e.message : "提供処理に失敗しました",
      });
    }
  };

  const undo = async () => {
    try {
      const data = await apiFetch<{ result: { revertedItemCount: number } }>(
        "/api/undo",
        {
          method: "POST",
          body: JSON.stringify({ confirm: true }),
        },
      );
      notify({
        level: "success",
        message: `取り消しました（${data.result.revertedItemCount} 件）`,
      });
      await reload();
    } catch (e) {
      notify({
        level: "error",
        message: e instanceof Error ? e.message : "取り消しに失敗しました",
      });
    }
  };

  if (loading || !session) {
    return <LoadingScreen />;
  }

  return (
    <>
      <TerminalBanner
        actorId={session.actor.actorId}
        actorType={session.actor.actorType}
        actorLabel={session.actor.label}
        offlineActors={session.offlineActors}
      />
      <DashboardShell
        eyebrow="LIVE TERMINAL"
        title={`${labelOf(ACTOR_TYPE_LABEL, session.actor.actorType)} · ${session.actor.label}`}
        subtitle="配膳待ちを優先順で処理"
        hideHeader
      >
        <div className="grid">
          <Card className="card">
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
              {dineInTiles.length === 0 && (
                <div className="muted">配膳待ちはありません</div>
              )}
              {dineInTiles.map((order) => {
                const tone = queueTone(order.elapsedSeconds);

                return (
                  <article key={order.id} className={`waiter-tile ${tone}`}>
                    <div className="waiter-tile-head">
                      <div className="waiter-major">
                        <span className="waiter-major-label">テーブル番号</span>
                        <span className="waiter-major-value">
                          {order.tableNo ?? "-"}
                        </span>
                      </div>
                      <span className="badge">注文 #{order.orderNo}</span>
                    </div>
                    <div className="muted waiter-tile-elapsed">
                      注文から {order.elapsedSinceOrdered}
                    </div>

                    <div className="list waiter-ready-list">
                      {order.readyItems.map((item) => (
                        <div
                          key={item.id}
                          className="list-item row between wrap"
                          style={{ padding: "8px 10px" }}
                        >
                          <span>{item.name}</span>
                          <button
                            type="button"
                            className="ghost-btn waiter-serve-btn"
                            onClick={() => serveItem(item.id)}
                          >
                            提供済み
                          </button>
                        </div>
                      ))}
                    </div>

                    {order.readyItems.length > 1 && (
                      <button
                        type="button"
                        className="waiter-bulk-btn"
                        onClick={() => serveOrder(order.id)}
                      >
                        全て提供済みにする
                      </button>
                    )}

                    {order.specialNote && (
                      <div className="notice" style={{ marginTop: 8 }}>
                        {order.specialNote}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            <h3 style={{ margin: "14px 0 10px" }}>持ち帰り</h3>
            <div className="waiter-tile-grid">
              {takeoutTiles.length === 0 && (
                <div className="muted">配膳待ちの持ち帰り注文はありません</div>
              )}
              {takeoutTiles.map((order) => (
                <article
                  key={order.id}
                  className={`waiter-tile ${queueTone(order.elapsedSeconds)}`}
                >
                  <div className="waiter-tile-head">
                    <div className="waiter-major">
                      <span className="waiter-major-label">注文番号</span>
                      <span className="waiter-major-value">
                        {order.orderNo}
                      </span>
                    </div>
                    <span className="badge">{order.itemCount} 品</span>
                  </div>
                  <div className="muted waiter-tile-elapsed">
                    注文から {order.elapsedSinceOrdered}
                  </div>
                  <div className="muted waiter-ready-list">
                    {bundleTakeoutItems(order.itemNames).join(" / ")}
                  </div>
                  <button
                    type="button"
                    className="waiter-bulk-btn"
                    onClick={() => serveOrder(order.id)}
                  >
                    提供済み
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
