"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { AVAILABILITY_LABEL, labelOf } from "@/lib/labels";
import { useToast } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type QueueMenu = {
  menuId: string;
  menuName: string;
  queuedCount: number;
  oldestQueuedSeconds: number;
};

type KitchenActor = {
  id: string;
  actorType: "POS" | "KITCHEN" | "WAITER" | "MENU_DISPLAY" | "ADMIN";
  label: string;
  isActive: boolean;
  kitchenEnabled: boolean;
  kitchenDisplayOrder: number;
};

type AdminMenuPayload = {
  menus: Array<{
    id: string;
    name: string;
    availability: "AVAILABLE" | "PAUSED" | "SOLD_OUT";
    isActive: boolean;
    hasActiveKitchenCoverage: boolean;
  }>;
};

type AssignmentPayload = {
  assignments: Array<{
    menuId: string;
    kitchenId: string;
    enabled: boolean;
  }>;
};

function newMutationKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

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

const AVAILABILITY_OPTIONS: Array<"AVAILABLE" | "PAUSED" | "SOLD_OUT"> = ["AVAILABLE", "PAUSED", "SOLD_OUT"];
const STATUS_BUTTON_ACTIVE_TONE: Record<"AVAILABLE" | "PAUSED" | "SOLD_OUT", string> = {
  AVAILABLE:
    "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700",
  PAUSED: "border-amber-700 bg-amber-500 text-white hover:bg-amber-600",
  SOLD_OUT: "border-rose-700 bg-rose-600 text-white hover:bg-rose-700"
};

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="section-title text-base font-semibold tracking-tight">{children}</h2>;
}

export default function KitchenPage() {
  const { loading, session } = useSession(["KITCHEN"]);
  const { notify } = useToast();

  const [queues, setQueues] = useState<QueueMenu[]>([]);
  const [myKitchen, setMyKitchen] = useState<KitchenActor | null>(null);
  const [busy, setBusy] = useState(false);
  const [menus, setMenus] = useState<AdminMenuPayload["menus"]>([]);
  const [assignments, setAssignments] = useState<AssignmentPayload["assignments"]>([]);
  const [availabilityBusyMenuId, setAvailabilityBusyMenuId] = useState<string | null>(null);

  const [pickerMenuId, setPickerMenuId] = useState<string | null>(null);
  const [pickerQuantity, setPickerQuantity] = useState<number>(1);

  const [tickNow, setTickNow] = useState(Date.now());
  const [queueFetchedAt, setQueueFetchedAt] = useState(Date.now());

  const reloadInFlightRef = useRef(false);

  const reload = async () => {
    if (!session || reloadInFlightRef.current) {
      return;
    }
    reloadInFlightRef.current = true;

    try {
      const [queue, actorPayload, menuPayload, assignmentPayload] = await Promise.all([
        apiFetch<{ queues: QueueMenu[] }>("/api/kitchen/queue"),
        apiFetch<{ actors: KitchenActor[] }>("/api/admin/actors"),
        apiFetch<AdminMenuPayload>("/api/admin/menus"),
        apiFetch<AssignmentPayload>("/api/admin/assignments")
      ]);

      setQueues(queue.queues);
      setQueueFetchedAt(Date.now());
      setMyKitchen(actorPayload.actors.find((actor) => actor.id === session.actor.actorId) ?? null);
      setMenus(menuPayload.menus.filter((menu) => menu.isActive));
      setAssignments(assignmentPayload.assignments);
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "キッチンデータの更新に失敗しました" });
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
    channels: session ? ["orders", "menus", "actors", `kitchen:${session.actor.actorId}`] : ["orders"],
    onEvent: () => {
      void reload();
    },
    onResync: () => {
      void reload();
    }
  });

  const myMenuIds = useMemo(() => {
    if (!session) {
      return new Set<string>();
    }

    return new Set(assignments.filter((row) => row.kitchenId === session.actor.actorId && row.enabled).map((row) => row.menuId));
  }, [assignments, session]);

  const controllableMenus = useMemo(() => {
    return menus.filter((menu) => myMenuIds.has(menu.id)).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, [menus, myMenuIds]);

  const submitReady = async (menuId: string, quantity: number) => {
    setBusy(true);
    try {
      const result = await apiFetch<{ markedReadyCount: number; affectedOrderCount: number }>("/api/kitchen/menus/ready", {
        method: "POST",
        body: JSON.stringify({ menuId, quantity, idempotencyKey: newMutationKey() })
      });

      notify({
        level: "success",
        message: `${result.markedReadyCount} 件を提供可能に更新しました（対象注文 ${result.affectedOrderCount} 件）`
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
      notify({ level: "success", message: `取り消しました（${data.result.revertedItemCount} 件）` });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "取り消しに失敗しました" });
    }
  };

  const setKitchenEnabled = async (nextEnabled: boolean) => {
    if (!session || !myKitchen) {
      return;
    }

    try {
      await apiFetch("/api/kitchen/toggle", {
        method: "POST",
        body: JSON.stringify({ kitchenId: session.actor.actorId, kitchenEnabled: nextEnabled })
      });
      notify({ level: "success", message: nextEnabled ? "キッチン稼働に変更しました" : "キッチン停止に変更しました" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "キッチン状態の更新に失敗しました" });
    }
  };

  const changeAvailability = async (menuId: string, availability: "AVAILABLE" | "PAUSED" | "SOLD_OUT") => {
    const menu = controllableMenus.find((row) => row.id === menuId);
    if (!menu) {
      return;
    }

    if (availability === "AVAILABLE" && !menu.hasActiveKitchenCoverage) {
      notify({ level: "error", message: "現在対応できるキッチンがないため、販売中にできません" });
      return;
    }

    setAvailabilityBusyMenuId(menuId);

    try {
      await apiFetch("/api/kitchen/menu-availability", {
        method: "POST",
        body: JSON.stringify({ menuId, availability })
      });
      notify({ level: "success", message: `${menu.name} を ${labelOf(AVAILABILITY_LABEL, availability)} に変更しました` });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "メニュー状態の更新に失敗しました" });
    } finally {
      setAvailabilityBusyMenuId(null);
    }
  };

  if (loading || !session) {
    return <main>読み込み中...</main>;
  }

  const elapsedSinceFetchSec = Math.floor((tickNow - queueFetchedAt) / 1000);

  return (
    <>
      <TerminalBanner actorId={session.actor.actorId} actorType={session.actor.actorType} actorLabel={session.actor.label} offlineActors={session.offlineActors} />
      <DashboardShell
        title="キッチンダッシュボード"
      >
        <div className="grid">
        <Card className="card">
          <div className="row between wrap" style={{ marginBottom: 10 }}>
            <SectionTitle>キッチンキュー</SectionTitle>
            <div className="row wrap">
              <button type="button" className="ghost-btn" onClick={undo}>
                取り消し
              </button>
              <label className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
                <span className="text-muted-foreground">キッチン稼働</span>
                <Switch checked={Boolean(myKitchen?.kitchenEnabled)} onCheckedChange={(checked) => void setKitchenEnabled(checked)} />
              </label>
              <Link href="/order-book" className="btn-link ghost-btn">
                オーダーブック
              </Link>
            </div>
          </div>

          <div className="queue-grid">
            {queues.length === 0 && <div className="muted">現在キューはありません</div>}
            {queues.map((queue) => {
              const currentElapsed = queue.oldestQueuedSeconds + elapsedSinceFetchSec;
              const tone = queueTone(currentElapsed);
              const pickerOpen = pickerMenuId === queue.menuId;

              return (
                <div key={queue.menuId} className={`queue-card ${tone}`}>
                  <div className="queue-menu-name">{queue.menuName}</div>

                  {pickerOpen ? (
                    <div className="queue-picker">
                      <div className="stepper">
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => setPickerQuantity((prev) => Math.max(1, prev - 1))}
                        >
                          -
                        </button>
                        <div className="stepper-count">{pickerQuantity}</div>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => setPickerQuantity((prev) => Math.min(queue.queuedCount, prev + 1))}
                        >
                          +
                        </button>
                      </div>
                      <div className="row wrap">
                        <button type="button" disabled={busy} onClick={() => submitReady(queue.menuId, pickerQuantity)}>
                          提供可能にする
                        </button>
                        <button type="button" className="ghost-btn" disabled={busy} onClick={() => setPickerMenuId(null)}>
                          閉じる
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="queue-count">{queue.queuedCount}</div>
                      <div className="muted">最古: {formatMss(currentElapsed)}</div>
                      <button type="button" disabled={busy} onClick={() => readyFromCard(queue)}>
                        提供可能へ更新
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="card">
          <SectionTitle>担当メニューの提供状態</SectionTitle>
          <div className="list">
            {controllableMenus.length === 0 && <div className="muted">担当メニューがありません</div>}
            {controllableMenus.map((menu) => (
              <div key={menu.id} className="list-item">
                <div className="row between wrap">
                  <strong>{menu.name}</strong>
                </div>
                <div className="menu-status-grid" style={{ marginTop: 8 }}>
                  {AVAILABILITY_OPTIONS.map((status) => {
                    const noCoverageForAvailable = status === "AVAILABLE" && !menu.hasActiveKitchenCoverage;
                    const disabled = availabilityBusyMenuId === menu.id;
                    const active = menu.availability === status;

                    return (
                      <Button
                        key={status}
                        type="button"
                        variant={active ? "default" : "outline"}
                        disabled={disabled}
                        className={cn(
                          "h-8 px-2 text-[11px] font-semibold leading-none",
                          noCoverageForAvailable && !active && "opacity-50",
                          active
                            ? STATUS_BUTTON_ACTIVE_TONE[status]
                            : "bg-background text-foreground hover:bg-muted"
                        )}
                        onClick={() => {
                          if (noCoverageForAvailable) {
                            notify({ level: "error", message: "現在対応できるキッチンがないため、販売中にできません" });
                            return;
                          }
                          void changeAvailability(menu.id, status);
                        }}
                      >
                        {labelOf(AVAILABILITY_LABEL, status)}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
        </div>
      </DashboardShell>
    </>
  );
}


