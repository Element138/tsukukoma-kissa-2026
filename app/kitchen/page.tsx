"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { useMidnightRefresh } from "@/components/use-midnight-refresh";
import { tokyoDateKey } from "@/lib/time";
import { useWakeLock } from "@/components/use-wake-lock";
import { ACTOR_TYPE_LABEL, AVAILABILITY_LABEL, labelOf } from "@/lib/labels";
import { useToast } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Minus, Plus } from "lucide-react";

type KitchenMenuRow = {
  menuId: string;
  menuName: string;
  availability: "AVAILABLE" | "INCREASED_WAIT" | "PAUSED" | "SOLD_OUT";
  hasActiveKitchenCoverage: boolean;
  queuedCount: number;
  surplusCount: number;
  readyCount: number;
  todayCookedCount: number;
  oldestQueuedSeconds: number;
  oldestElapsed: string;
  queuedOrders: Array<{
    itemId: string;
    orderNo: number;
    confirmedAt: string | null;
    queuedSeconds: number;
    elapsed: string;
  }>;
  todayOrderCount: number;
  remainingUntilCap: number | null;
  dailyOrderCap: number | null;
  isCapReached: boolean;
};

type KitchenActor = {
  id: string;
  actorType:
    | "POS"
    | "KITCHEN"
    | "WAITER"
    | "MENU_DISPLAY"
    | "ORDER_DISPLAY"
    | "ADMIN";
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

const AVAILABILITY_OPTIONS: Array<
  "AVAILABLE" | "INCREASED_WAIT" | "PAUSED" | "SOLD_OUT"
> = ["AVAILABLE", "INCREASED_WAIT", "PAUSED", "SOLD_OUT"];
const STATUS_BUTTON_ACTIVE_TONE: Record<
  "AVAILABLE" | "INCREASED_WAIT" | "PAUSED" | "SOLD_OUT",
  string
> = {
  AVAILABLE:
    "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700",
  INCREASED_WAIT: "border-amber-700 bg-amber-500 text-white hover:bg-amber-600",
  PAUSED: "border-orange-700 bg-orange-500 text-white hover:bg-orange-600",
  SOLD_OUT: "border-rose-700 bg-rose-600 text-white hover:bg-rose-700",
};

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="section-title text-base font-semibold tracking-tight">
      {children}
    </h2>
  );
}

export default function KitchenPage() {
  const { loading, session } = useSession(["KITCHEN"]);
  const { notify } = useToast();
  useWakeLock(Boolean(session));

  const [menus, setMenus] = useState<KitchenMenuRow[]>([]);
  const [myKitchen, setMyKitchen] = useState<KitchenActor | null>(null);
  const [busy, setBusy] = useState(false);
  const [availabilityBusyMenuId, setAvailabilityBusyMenuId] = useState<
    string | null
  >(null);
  const [capBusyMenuId, setCapBusyMenuId] = useState<string | null>(null);

  const [readyQuantityByMenuId, setReadyQuantityByMenuId] = useState<
    Record<string, number>
  >({});
  const [capPickerMenuId, setCapPickerMenuId] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState<number>(1);
  const [capUnlimited, setCapUnlimited] = useState<boolean>(true);

  const readyInFlightRef = useRef(false);

  const reloadInFlightRef = useRef(false);
  const queuedReloadModeRef = useRef<"all" | "menus" | null>(null);

  const reload = async (mode: "all" | "menus" = "all") => {
    if (!session || reloadInFlightRef.current) {
      if (session && reloadInFlightRef.current) {
        if (queuedReloadModeRef.current !== "all") {
          queuedReloadModeRef.current =
            mode === "all" ? "all" : (queuedReloadModeRef.current ?? "menus");
        }
      }
      return;
    }
    reloadInFlightRef.current = true;
    const requestDay=tokyoDateKey();

    try {
      const tasks: Promise<void>[] = [];
      tasks.push(
        apiFetch<{ menus: KitchenMenuRow[] }>("/api/kitchen/queue").then(
          (payload) => {
            if(requestDay!==tokyoDateKey()){queuedReloadModeRef.current??="menus";return;}
            setMenus(payload.menus);
            setReadyQuantityByMenuId((prev) => {
              const next: Record<string, number> = {};
              for (const menu of payload.menus) {
                const max = 999;
                const current = prev[menu.menuId] ?? 1;
                next[menu.menuId] = Math.max(-Math.min(max, menu.readyCount ?? 0), Math.min(max, current));
              }
              return next;
            });
          },
        ),
      );

      if (mode === "all") {
        tasks.push(
          apiFetch<{ actors: KitchenActor[] }>("/api/admin/actors").then(
            (actorPayload) => {
              setMyKitchen(
                actorPayload.actors.find(
                  (actor) => actor.id === session.actor.actorId,
                ) ?? null,
              );
            },
          ),
        );
      }

      await Promise.all(tasks);
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "キッチンデータの更新に失敗しました",
      });
    } finally {
      reloadInFlightRef.current = false;
      const queuedMode = queuedReloadModeRef.current;
      queuedReloadModeRef.current = null;
      if (queuedMode) {
        void reload(queuedMode);
      }
    }
  };

  useEffect(() => {
    if (!session) {
      return;
    }
    void reload("all");
  }, [session]);


  useMidnightRefresh(Boolean(session),dayChanged=>{
    if(dayChanged)setMenus(current=>current.map(menu=>({...menu,queuedCount:menu.queuedOrders.length,surplusCount:0,readyCount:0})));
    void reload("menus");
  });
  useRealtimeSubscription({
    enabled: Boolean(session),
    channels: session
      ? ["orders", "menus", "actors", `kitchen:${session.actor.actorId}`]
      : ["orders"],
    onEvent: (event) => {
      if (event.channel === "orders" || event.channel.startsWith("kitchen:")) {
        void reload("menus");
        return;
      }
      void reload("all");
    },
    onResync: () => {
      void reload("all");
    },
  });

  const orderedMenus = useMemo(() => menus, [menus]);

  const submitReady = async (menuId: string, quantity: number) => {
    if (readyInFlightRef.current) return;
    readyInFlightRef.current = true;
    setBusy(true);
    const idempotencyKey = newMutationKey();
    const submit = (confirmOverCap: boolean) => apiFetch<{ markedReadyCount: number }>("/api/kitchen/menus/ready", {
      method: "POST", body: JSON.stringify({ menuId, quantity, idempotencyKey, confirmOverCap }),
    });
    try {
      let result;
      try { result = await submit(false); }
      catch (e) {
        if (!(e instanceof ApiError) || e.code !== "COOKED_CAP_CONFIRM_REQUIRED") throw e;
        if (!window.confirm("本日の調理完了数が上限を超えます。調理完了にしますか？")) return;
        result = await submit(true);
      }
      setReadyQuantityByMenuId(prev => ({ ...prev, [menuId]: 1 }));
      notify({ level: "success", message: result.markedReadyCount < 0 ? `調理済みを ${Math.abs(result.markedReadyCount)} 個減らしました` : `${result.markedReadyCount} 個を調理済みにしました` });
      await reload("menus");
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "調理済みへの更新に失敗しました" });
      if (quantity < 0) await reload("menus");
    } finally { readyInFlightRef.current = false; setBusy(false); }
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
        message: `取り消しました（${data.result.revertedItemCount} 個）`,
      });
      await reload("menus");
    } catch (e) {
      notify({
        level: "error",
        message: e instanceof Error ? e.message : "取り消しに失敗しました",
      });
    }
  };

  const setKitchenEnabled = async (nextEnabled: boolean) => {
    if (!session || !myKitchen) {
      return;
    }

    try {
      await apiFetch("/api/kitchen/toggle", {
        method: "POST",
        body: JSON.stringify({
          kitchenId: session.actor.actorId,
          kitchenEnabled: nextEnabled,
        }),
      });
      notify({
        level: "success",
        message: nextEnabled
          ? "注文を受け付けるようにしました"
          : "注文を受け付けないようにしました",
      });
      await reload("all");
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "注文受付状態の更新に失敗しました",
      });
    }
  };

  const changeAvailability = async (
    menu: KitchenMenuRow,
    availability: "AVAILABLE" | "INCREASED_WAIT" | "PAUSED" | "SOLD_OUT",
  ) => {
    if (
      (availability === "AVAILABLE" || availability === "INCREASED_WAIT") &&
      !menu.hasActiveKitchenCoverage
    ) {
      notify({
        level: "error",
        message: "現在対応できるキッチンがないため、販売中にできません",
      });
      return;
    }
    if (
      menu.isCapReached &&
      (availability === "AVAILABLE" ||
        availability === "INCREASED_WAIT" ||
        availability === "PAUSED")
    ) {
      notify({
        level: "error",
        message: "本日の上限に達しているため変更できません",
      });
      return;
    }

    setAvailabilityBusyMenuId(menu.menuId);
    try {
      await apiFetch("/api/kitchen/menu-availability", {
        method: "POST",
        body: JSON.stringify({ menuId: menu.menuId, availability }),
      });
      notify({
        level: "success",
        message: `${menu.menuName} を ${labelOf(AVAILABILITY_LABEL, availability)} に変更しました`,
      });
      await reload("menus");
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "メニュー状態の更新に失敗しました",
      });
    } finally {
      setAvailabilityBusyMenuId(null);
    }
  };

  const openCapEditor = (menu: KitchenMenuRow) => {
    setCapPickerMenuId(menu.menuId);
    if (menu.dailyOrderCap == null) {
      setCapUnlimited(true);
      setCapDraft(1);
      return;
    }
    setCapUnlimited(false);
    setCapDraft(Math.max(1, menu.dailyOrderCap));
  };

  const saveCap = async (menu: KitchenMenuRow) => {
    setCapBusyMenuId(menu.menuId);
    try {
      await apiFetch("/api/kitchen/menu-cap", {
        method: "POST",
        body: JSON.stringify({
          menuId: menu.menuId,
          dailyOrderCap: capUnlimited ? null : Math.max(1, capDraft),
        }),
      });
      notify({
        level: "success",
        message: capUnlimited
          ? `${menu.menuName} の上限を無制限にしました`
          : `${menu.menuName} の上限を ${Math.max(1, capDraft)} にしました`,
      });
      setCapPickerMenuId(null);
      await reload("menus");
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "上限設定の更新に失敗しました",
      });
    } finally {
      setCapBusyMenuId(null);
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
        title={`${labelOf(ACTOR_TYPE_LABEL, session.actor.actorType)} · ${session.actor.label}`}
        hideHeader
      >
        <div className="grid">
          <Card className="card">
            <div className="row between wrap" style={{ marginBottom: 10 }}>
              <SectionTitle>キッチンビュー</SectionTitle>
              <div className="row wrap">
                <button type="button" className="ghost-btn" onClick={undo}>
                  取り消し
                </button>
                <label className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
                  <span className="text-muted-foreground">
                    注文を受け付ける
                  </span>
                  <Switch
                    checked={Boolean(myKitchen?.kitchenEnabled)}
                    onCheckedChange={(checked) =>
                      void setKitchenEnabled(checked)
                    }
                  />
                </label>
              </div>
            </div>

            <div className="kitchen-menus-grid">
              {orderedMenus.length === 0 && (
                <div className="muted">担当メニューがありません</div>
              )}
              {orderedMenus.map((menu) => {
                const capPickerOpen = capPickerMenuId === menu.menuId;
                const capValue = menu.dailyOrderCap;
                const readyQuantity = Math.max(
                  -Math.min(999, menu.readyCount ?? 0),
                  Math.min(
                    999,
                    readyQuantityByMenuId[menu.menuId] ?? 1,
                  ),
                );

                return (
                  <article
                    key={menu.menuId}
                    className="queue-card kitchen-menu-tile"
                  >
                    <div className="row between wrap">
                      <div>
                        <div className="queue-menu-name">{menu.menuName}</div>
                      </div>
                    </div>

                    <div className="kitchen-menu-metrics">
                      <div className="kitchen-queued-headline">
                        <span className={cn("kitchen-queued-big", menu.surplusCount > 0 && "muted")}>
                          {menu.surplusCount > 0 ? menu.surplusCount : menu.queuedCount}
                        </span>
                        <small className={menu.surplusCount > 0 ? "muted" : ""}>{menu.surplusCount > 0 ? "個余剰" : "個調理待ち"}</small>
                      </div>
                      <div className="kitchen-cap-inline">
                        <span className="kitchen-cap-summary">
                          本日 {menu.todayOrderCount} 個注文済み
                          {capValue == null
                            ? ""
                            : " / 上限 " + capValue + " 個"}
                        </span>
                        {capPickerOpen ? (
                          <div className="kitchen-cap-editor-inline">
                            <button
                              type="button"
                              className={cn(
                                "ghost-btn kitchen-cap-inline-btn",
                                capUnlimited && "active",
                              )}
                              onClick={() => setCapUnlimited(true)}
                            >
                              無制限
                            </button>
                            <button
                              type="button"
                              className="ghost-btn kitchen-cap-inline-btn"
                              onClick={() => {
                                setCapUnlimited(false);
                                setCapDraft((prev) => Math.max(1, prev - 1));
                              }}
                            >
                              -
                            </button>
                            <span className="kitchen-cap-inline-value">
                              {capUnlimited ? "∞" : capDraft}
                            </span>
                            <button
                              type="button"
                              className="ghost-btn kitchen-cap-inline-btn"
                              onClick={() => {
                                setCapUnlimited(false);
                                setCapDraft((prev) =>
                                  Math.min(100000, prev + 1),
                                );
                              }}
                            >
                              +
                            </button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 px-3 text-xs"
                              disabled={capBusyMenuId === menu.menuId}
                              onClick={() => void saveCap(menu)}
                            >
                              保存
                            </Button>
                            <button
                              type="button"
                              className="ghost-btn kitchen-cap-inline-btn"
                              onClick={() => setCapPickerMenuId(null)}
                            >
                              閉じる
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="ghost-btn kitchen-cap-edit-trigger"
                            onClick={() => openCapEditor(menu)}
                          >
                            変更
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="menu-status-grid kitchen-availability-grid">
                      {AVAILABILITY_OPTIONS.map((status) => {
                        const noCoverageForAvailable =
                          (status === "AVAILABLE" ||
                            status === "INCREASED_WAIT") &&
                          !menu.hasActiveKitchenCoverage;
                        const capBlockedStatus =
                          menu.isCapReached &&
                          (status === "AVAILABLE" ||
                            status === "INCREASED_WAIT" ||
                            status === "PAUSED");
                        const disabled =
                          availabilityBusyMenuId === menu.menuId ||
                          capBlockedStatus;
                        const active = menu.availability === status;

                        return (
                          <Button
                            key={status}
                            type="button"
                            variant={active ? "default" : "outline"}
                            disabled={disabled}
                            className={cn(
                              "h-8 px-2 text-[11px] font-semibold leading-none",
                              (noCoverageForAvailable || capBlockedStatus) &&
                                !active &&
                                "opacity-50",
                              active
                                ? STATUS_BUTTON_ACTIVE_TONE[status]
                                : "bg-background text-foreground hover:bg-muted",
                            )}
                            onClick={() => {
                              if (noCoverageForAvailable) {
                                notify({
                                  level: "error",
                                  message:
                                    "現在対応できるキッチンがないため、販売中にできません",
                                });
                                return;
                              }
                              if (capBlockedStatus) {
                                notify({
                                  level: "error",
                                  message:
                                    "本日の上限に達しているため変更できません",
                                });
                                return;
                              }
                              void changeAvailability(menu, status);
                            }}
                          >
                            {labelOf(AVAILABILITY_LABEL, status)}
                          </Button>
                        );
                      })}
                    </div>

                    <div
                      className="ready-action-group"
                      role="group"
                      aria-label={`${menu.menuName} の調理済み操作`}
                    >
                      <div className="ready-action-row">
                          <button
                            type="button"
                            className="ready-edge-control ready-edge-control-left"
                            aria-label="数量を減らす"
                            disabled={busy || readyQuantity <= -Math.min(999, menu.readyCount ?? 0)}
                            onClick={() =>
                              setReadyQuantityByMenuId((prev) => ({
                                ...prev,
                                [menu.menuId]: Math.max(-Math.min(999, menu.readyCount ?? 0), readyQuantity - 1),
                              }))
                            }
                          >
                            <Minus aria-hidden="true" />
                          </button>
                        <button
                          type="button"
                          className={cn("ready-action-submit", readyQuantity < 0 && "ready-action-submit-negative")}
                          disabled={busy || readyQuantity === 0}
                          onClick={() =>
                            void submitReady(
                              menu.menuId,
                              readyQuantity,
                            )
                          }
                        >
                          {Math.abs(readyQuantity)}
                          {readyQuantity < 0 ? "個調理済みを減らす" : "個調理済みにする"}
                        </button>
                          <button
                            type="button"
                            className="ready-edge-control ready-edge-control-right"
                            aria-label="数量を増やす"
                            disabled={busy || readyQuantity >= 999}
                            onClick={() =>
                              setReadyQuantityByMenuId((prev) => ({
                                ...prev,
                                [menu.menuId]: Math.min(
                                  999,
                                  readyQuantity + 1,
                                ),
                              }))
                            }
                          >
                            <Plus aria-hidden="true" />
                          </button>
                      </div>
                    </div>


                  </article>
                );
              })}
            </div>
          </Card>
        </div>
      </DashboardShell>
    </>
  );
}
