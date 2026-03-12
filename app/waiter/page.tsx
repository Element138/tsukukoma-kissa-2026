"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

function formatMss(totalSeconds: number) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export default function WaiterPage() {
  const { loading, session } = useSession(["WAITER"]);
  const { notify } = useToast();

  const [dineInItems, setDineInItems] = useState<DineInItem[]>([]);
  const [takeoutOrders, setTakeoutOrders] = useState<TakeoutOrder[]>([]);
  const [tickNow, setTickNow] = useState(Date.now());
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

  const dineInRows = useMemo(
    () =>
      dineInItems.map((item) => {
        const readyMs = new Date(item.readyAt).getTime();
        return {
          ...item,
          readyElapsed: formatMss(Math.floor((tickNow - readyMs) / 1000))
        };
      }),
    [dineInItems, tickNow]
  );

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
      <main className="grid two">
        <Card>
          <SectionTitle>店内配膳待ち</SectionTitle>
          <div className="row wrap" style={{ marginBottom: 10 }}>
            <button type="button" className="ghost-btn" onClick={undo}>
              取り消し
            </button>
            <Link href="/order-book" className="btn-link ghost-btn">
              オーダーブック
            </Link>
          </div>

          <div className="list">
            {dineInRows.length === 0 && <div className="muted">配膳待ちはありません</div>}
            {dineInRows.map((item) => (
              <div key={item.id} className="list-item">
                <div className="row between wrap">
                  <div>
                    <strong>{item.name}</strong>
                    <div className="muted">テーブル {item.tableNo ?? "-"} / 注文 #{item.orderNo}</div>
                    <div className="muted">準備完了から {item.readyElapsed}</div>
                  </div>
                  <button type="button" onClick={() => serveItem(item.id)}>
                    提供済みにする
                  </button>
                </div>
                {item.specialNote && <div className="notice" style={{ marginTop: 8 }}>{item.specialNote}</div>}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>持ち帰り配膳待ち</SectionTitle>
          <div className="list">
            {takeoutOrders.length === 0 && <div className="muted">配膳待ちの持ち帰り注文はありません</div>}
            {takeoutOrders.map((order) => (
              <div key={order.id} className="list-item">
                <div className="row between wrap">
                  <div>
                    <strong>注文 #{order.orderNo}</strong>
                    <div className="muted">{order.itemCount} 品</div>
                  </div>
                  <button type="button" onClick={() => serveOrder(order.id)}>
                    まとめて提供済みにする
                  </button>
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
