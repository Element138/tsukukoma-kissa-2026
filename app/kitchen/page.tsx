"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { Card, SectionTitle } from "@/components/ui";
import { TerminalBanner } from "@/components/terminal-banner";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { useToast } from "@/components/toast";

type QueueMenu = {
  menuId: string;
  menuName: string;
  queuedCount: number;
  oldestQueuedSeconds: number;
  oldestElapsed: string;
  kitchenName: string;
  kitchenInactiveWarning: boolean;
};

type KitchenActor = {
  id: string;
  actorType: "POS" | "KITCHEN" | "WAITER" | "MENU_DISPLAY" | "ADMIN";
  label: string;
  isActive: boolean;
  kitchenEnabled: boolean;
  kitchenDisplayOrder: number;
};

function newMutationKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
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

export default function KitchenPage() {
  const { loading, session } = useSession(["KITCHEN"]);
  const { notify } = useToast();

  const [queues, setQueues] = useState<QueueMenu[]>([]);
  const [myKitchen, setMyKitchen] = useState<KitchenActor | null>(null);
  const [busy, setBusy] = useState(false);

  const [pickerMenuId, setPickerMenuId] = useState<string | null>(null);
  const [pickerQuantity, setPickerQuantity] = useState<number>(1);

  const reloadInFlightRef = useRef(false);

  const reload = async () => {
    if (!session || reloadInFlightRef.current) {
      return;
    }
    reloadInFlightRef.current = true;

    try {
      const [queue, actorPayload] = await Promise.all([
        apiFetch<{ queues: QueueMenu[] }>("/api/kitchen/queue"),
        apiFetch<{ actors: KitchenActor[] }>("/api/admin/actors")
      ]);

      setQueues(queue.queues);
      setMyKitchen(actorPayload.actors.find((actor) => actor.id === session.actor.actorId) ?? null);
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "キッチンデータの取得に失敗しました" });
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
    channels: session ? ["orders", "menus", "actors", `kitchen:${session.actor.actorId}`] : ["orders"],
    onEvent: () => {
      void reload();
    },
    onResync: () => {
      void reload();
    }
  });

  const submitReady = async (menuId: string, quantity: number) => {
    setBusy(true);
    try {
      const result = await apiFetch<{ markedReadyCount: number; affectedOrderCount: number }>("/api/kitchen/menus/ready", {
        method: "POST",
        body: JSON.stringify({ menuId, quantity, idempotencyKey: newMutationKey() })
      });

      notify({
        level: "success",
        message: `${result.markedReadyCount}品を提供可能に更新しました（対象注文 ${result.affectedOrderCount} 件）`
      });

      setPickerMenuId(null);
      setPickerQuantity(1);
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "提供可能への更新に失敗しました" });
    } finally {
      setBusy(false);
    }
  };

  const readyFromCard = async (queue: QueueMenu) => {
    if (queue.queuedCount <= 1) {
      await submitReady(queue.menuId, 1);
      return;
    }
    setPickerMenuId(queue.menuId);
    setPickerQuantity(Math.min(queue.queuedCount, 1));
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

  const toggleKitchen = async () => {
    if (!session || !myKitchen) {
      return;
    }

    try {
      await apiFetch("/api/kitchen/toggle", {
        method: "POST",
        body: JSON.stringify({ kitchenId: session.actor.actorId, kitchenEnabled: !myKitchen.kitchenEnabled })
      });
      notify({ level: "success", message: myKitchen.kitchenEnabled ? "キッチンを停止しました" : "キッチンを有効化しました" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "キッチン状態の変更に失敗しました" });
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
      <main className="grid">
        <Card>
          <div className="row between wrap" style={{ marginBottom: 10 }}>
            <SectionTitle>キッチンキュー</SectionTitle>
            <div className="row wrap">
              <button onClick={undo} className="ghost-btn">
                取り消し
              </button>
              <button onClick={toggleKitchen} className="ghost-btn">
                {myKitchen?.kitchenEnabled ? "キッチン停止" : "キッチン有効化"}
              </button>
              <Link href="/order-book">
                <button className="ghost-btn">オーダーブック</button>
              </Link>
            </div>
          </div>

          <div className="queue-grid">
            {queues.length === 0 && <div className="muted">現在キューはありません</div>}
            {queues.map((queue) => {
              const tone = queueTone(queue.oldestQueuedSeconds);
              const pickerOpen = pickerMenuId === queue.menuId;

              return (
                <div key={queue.menuId} className={`queue-card ${tone}`}>
                  <div className="queue-menu-name">{queue.menuName}</div>

                  {pickerOpen ? (
                    <div className="queue-picker">
                      <input
                        type="number"
                        min={1}
                        max={queue.queuedCount}
                        value={pickerQuantity}
                        onChange={(e) => {
                          const raw = Number(e.target.value);
                          if (Number.isFinite(raw)) {
                            setPickerQuantity(Math.max(1, Math.min(queue.queuedCount, raw)));
                          }
                        }}
                      />
                      <div className="row wrap">
                        <button disabled={busy} onClick={() => submitReady(queue.menuId, pickerQuantity)}>
                          提供可能にする
                        </button>
                        <button className="ghost-btn" disabled={busy} onClick={() => setPickerMenuId(null)}>
                          戻る
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="queue-count">{queue.queuedCount}</div>
                      <div className="muted">最古: {queue.oldestElapsed}</div>
                      <button disabled={busy} onClick={() => readyFromCard(queue)}>
                        提供処理
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </main>
    </>
  );
}