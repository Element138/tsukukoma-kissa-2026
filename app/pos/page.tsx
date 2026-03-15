"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { ConfirmSlider } from "@/components/confirm-slider";
import { LoadingScreen } from "@/components/loading-screen";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { useWakeLock } from "@/components/use-wake-lock";
import {
  ACTOR_TYPE_LABEL,
  AVAILABILITY_LABEL,
  FULFILLMENT_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_SKIP_REASON_LABEL,
  PAYMENT_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  labelOf,
} from "@/lib/labels";
import { useToast } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AGE_GROUPS,
  type AgeGroupKey,
  ageGroupCountsToRanges,
  createEmptyAgeGroupCounts,
} from "@/lib/age-groups";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type MenuPayload = {
  menus: Array<{
    id: string;
    name: string;
    priceJpy: number;
    availability: "AVAILABLE" | "INCREASED_WAIT" | "PAUSED" | "SOLD_OUT";
    isActive: boolean;
    categoryId: string;
    displayOrder: number;
    hasActiveKitchenCoverage: boolean;
    todayOrderCount: number;
    dailyOrderCap: number | null;
    remainingUntilCap: number | null;
    isCapReached: boolean;
  }>;
  categories: Array<{
    id: string;
    name: string;
    displayOrder: number;
  }>;
};

const AVAILABILITY_OPTIONS: Array<
  "AVAILABLE" | "INCREASED_WAIT" | "PAUSED" | "SOLD_OUT"
> = [
  "AVAILABLE",
  "INCREASED_WAIT",
  "PAUSED",
  "SOLD_OUT",
];
const STATUS_BUTTON_ACTIVE_TONE: Record<
  "AVAILABLE" | "INCREASED_WAIT" | "PAUSED" | "SOLD_OUT",
  string
> = {
  AVAILABLE:
    "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700",
  INCREASED_WAIT:
    "border-amber-700 bg-amber-500 text-white hover:bg-amber-600",
  PAUSED: "border-orange-700 bg-orange-500 text-white hover:bg-orange-600",
  SOLD_OUT: "border-rose-700 bg-rose-600 text-white hover:bg-rose-700",
};
const WATCHDOG_HEARTBEAT_MS = 12_000;

type AwaitingOrderState = {
  id: string;
  orderNo: number;
  createdAt: string;
  paymentAwaitDeadlineAt: string | null;
  reopenDeepLink: string;
};

type IncidentState = {
  id: string;
  orderId: string;
  orderNo: number;
  responsiblePosActorId: string;
  messageJa: string;
  createdAt: string;
};

type TrackedOrderState = {
  id: string;
  orderNo: number;
  paymentStatus: string;
  orderStatus: string;
};

type DebugScenario = "none" | "success" | "failed" | "contradictory";

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="section-title text-base font-semibold tracking-tight">
      {children}
    </h2>
  );
}

function newIdempotencyKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function summarizeOrderErrorMessage(rawMessage: string) {
  const withoutTrace = rawMessage
    .replace(/\s*\[trace:[^\]]+\]\s*$/i, "")
    .trim();
  const withoutCode = withoutTrace.replace(/\s*\([A-Z0-9_]+\)\s*$/, "").trim();
  const normalized = withoutCode || "注文登録に失敗しました";
  if (normalized.length <= 48) {
    return normalized;
  }
  return `${normalized.slice(0, 48)}...`;
}

export default function PosPage() {
  const { loading, session } = useSession(["POS"]);
  const { notify } = useToast();
  useWakeLock(Boolean(session));

  const [menus, setMenus] = useState<MenuPayload | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});

  const [fulfillmentType, setFulfillmentType] = useState<"DINE_IN" | "TAKEOUT">(
    "DINE_IN",
  );
  const [tableNo, setTableNo] = useState<string>("");
  const [ageGroupCounts, setAgeGroupCounts] = useState<
    Record<AgeGroupKey, number>
  >(createEmptyAgeGroupCounts);
  const [specialNote, setSpecialNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<
    "CASH" | "SQUARE" | "PAYMENT_SKIPPED"
  >("CASH");
  const [skipReasonType, setSkipReasonType] = useState<
    "TEST" | "DEVICE_ERROR" | "NETWORK_ERROR" | "OTHER"
  >("TEST");
  const [skipReasonText, setSkipReasonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuAvailabilityBusyId, setMenuAvailabilityBusyId] = useState<
    string | null
  >(null);
  const [sliderErrorText, setSliderErrorText] = useState<string | null>(null);
  const [awaitingOrder, setAwaitingOrder] = useState<AwaitingOrderState | null>(
    null,
  );
  const [incidents, setIncidents] = useState<IncidentState[]>([]);
  const [pendingSquareOrderId, setPendingSquareOrderId] = useState<string | null>(
    null,
  );
  const [debugScenario, setDebugScenario] = useState<DebugScenario>("none");
  const notifiedIncidentIdsRef = useRef<Set<string>>(new Set());

  const loadMenus = async () => {
    const data = await apiFetch<MenuPayload>("/api/admin/menus");
    setMenus(data);
  };

  const resetInputsToDefault = () => {
    setCart({});
    setAgeGroupCounts(createEmptyAgeGroupCounts());
    setTableNo("");
    setSpecialNote("");
    setSkipReasonText("");
    setSliderErrorText(null);
  };

  const refreshPaymentState = async (trackOrderId?: string | null) => {
    const params = new URLSearchParams();
    const targetOrderId = trackOrderId ?? pendingSquareOrderId;
    if (targetOrderId) {
      params.set("trackOrderId", targetOrderId);
    }

    const data = await apiFetch<{
      awaitingOrder: AwaitingOrderState | null;
      incidents: IncidentState[];
      trackedOrder: TrackedOrderState | null;
    }>(`/api/payment-watchdog/ping?${params.toString()}`);

    setAwaitingOrder(data.awaitingOrder ?? null);
    setIncidents(data.incidents ?? []);

    for (const incident of data.incidents ?? []) {
      if (notifiedIncidentIdsRef.current.has(incident.id)) {
        continue;
      }
      notifiedIncidentIdsRef.current.add(incident.id);
      notify({
        level: "error",
        message: `決済異常: 注文 #${incident.orderNo} / ${incident.messageJa}`,
        durationMs: 9000,
      });
    }

    if (!targetOrderId || !data.trackedOrder) {
      return;
    }

    if (data.trackedOrder.paymentStatus === "PAID") {
      resetInputsToDefault();
      setPendingSquareOrderId(null);
      notify({
        level: "success",
        message: `注文 #${data.trackedOrder.orderNo} のSquare決済が完了しました`,
      });
      return;
    }

    if (data.trackedOrder.paymentStatus === "FAILED") {
      setPendingSquareOrderId(null);
      notify({
        level: "warning",
        message: `注文 #${data.trackedOrder.orderNo} は決済失敗で終了しました。入力内容は保持しています。`,
        durationMs: 9000,
      });
    }
  };

  const scheduleDebugSimulation = (orderId: string) => {
    if (debugScenario === "none") {
      return;
    }
    const randomDelayMs = (10 + Math.floor(Math.random() * 11)) * 1000;
    const debugCall = (result: "SUCCESS" | "FAILED", extraDelayMs: number) => {
      window.setTimeout(() => {
        void apiFetch("/api/debug/square-callback", {
          method: "POST",
          body: JSON.stringify({
            orderId,
            result,
            squareTransactionId: `debug-${Date.now()}`,
          }),
        }).catch((error) => {
          notify({
            level: "error",
            message:
              error instanceof Error
                ? error.message
                : "デバッグコールバック送信に失敗しました",
          });
        });
      }, extraDelayMs);
    };

    if (debugScenario === "success") {
      debugCall("SUCCESS", randomDelayMs);
      notify({
        level: "info",
        message: `DEBUG: ${Math.floor(randomDelayMs / 1000)}秒後にSUCCESSをシミュレート`,
      });
      return;
    }
    if (debugScenario === "failed") {
      debugCall("FAILED", randomDelayMs);
      notify({
        level: "info",
        message: `DEBUG: ${Math.floor(randomDelayMs / 1000)}秒後にFAILEDをシミュレート`,
      });
      return;
    }

    debugCall("FAILED", randomDelayMs);
    debugCall("SUCCESS", randomDelayMs + 5000);
    notify({
      level: "warning",
      message: `DEBUG: ${Math.floor(randomDelayMs / 1000)}秒後FAILED、その5秒後SUCCESS(矛盾ケース)`,
      durationMs: 10000,
    });
  };

  useEffect(() => {
    if (!session) {
      return;
    }

    loadMenus().catch((e) => notify({ level: "error", message: e.message }));
    void refreshPaymentState();
  }, [session, notify]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let cancelled = false;
    const pollState = () => {
      if (cancelled) {
        return;
      }
      void refreshPaymentState().catch(() => undefined);
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      pollState();
    };

    pollState();
    const timer = window.setInterval(onVisible, WATCHDOG_HEARTBEAT_MS);
    window.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("visibilitychange", onVisible);
    };
  }, [session, pendingSquareOrderId]);

  useRealtimeSubscription({
    enabled: Boolean(session),
    channels: ["orders"],
    onEvent: () => {
      void refreshPaymentState().catch(() => undefined);
    },
    onResync: () => {
      void refreshPaymentState().catch(() => undefined);
    },
  });

  useEffect(() => {
    if (!sliderErrorText) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSliderErrorText(null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [sliderErrorText]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey || !event.shiftKey) {
        return;
      }

      if (event.code === "Digit0") {
        event.preventDefault();
        setDebugScenario("none");
        notify({
          level: "info",
          message: "DEBUGシナリオを解除しました（本番投入前にショートカット実装も削除してください）",
          durationMs: 9000,
        });
        return;
      }
      if (event.code === "Digit1") {
        event.preventDefault();
        setDebugScenario("success");
        notify({
          level: "warning",
          message: "DEBUG: SUCCESSシナリオ有効 (Ctrl+Alt+Shift+0で解除)",
          durationMs: 9000,
        });
        return;
      }
      if (event.code === "Digit2") {
        event.preventDefault();
        setDebugScenario("failed");
        notify({
          level: "warning",
          message: "DEBUG: FAILEDシナリオ有効 (Ctrl+Alt+Shift+0で解除)",
          durationMs: 9000,
        });
        return;
      }
      if (event.code === "Digit3") {
        event.preventDefault();
        setDebugScenario("contradictory");
        notify({
          level: "warning",
          message: "DEBUG: 矛盾シナリオ有効 (Ctrl+Alt+Shift+0で解除)",
          durationMs: 9000,
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [session, notify]);

  const categoryOrderMap = useMemo(() => {
    if (!menus) {
      return new Map<string, number>();
    }
    return new Map(menus.categories.map((cat) => [cat.id, cat.displayOrder]));
  }, [menus]);

  const menuList = useMemo(() => {
    if (!menus) {
      return [] as MenuPayload["menus"];
    }

    return menus.menus
      .filter((m) => m.isActive)
      .sort((a, b) => {
        const categoryDiff =
          (categoryOrderMap.get(a.categoryId) ?? 9999) -
          (categoryOrderMap.get(b.categoryId) ?? 9999);
        if (categoryDiff !== 0) {
          return categoryDiff;
        }

        if (a.displayOrder !== b.displayOrder) {
          return a.displayOrder - b.displayOrder;
        }

        return a.name.localeCompare(b.name, "ja");
      });
  }, [menus, categoryOrderMap]);

  const selectedItems = useMemo(() => {
    return menuList
      .map((m) => ({ ...m, quantity: cart[m.id] ?? 0 }))
      .filter((m) => m.quantity > 0);
  }, [menuList, cart]);

  const total = selectedItems.reduce(
    (sum, item) => sum + item.priceJpy * item.quantity,
    0,
  );
  const displayTotal = paymentMethod === "PAYMENT_SKIPPED" ? 0 : total;
  const partySize = AGE_GROUPS.reduce(
    (sum, group) => sum + (ageGroupCounts[group.key] ?? 0),
    0,
  );

  const ageRanges = useMemo(() => {
    return ageGroupCountsToRanges(ageGroupCounts);
  }, [ageGroupCounts]);
  const parsedTableNo = Number(tableNo);
  const missingRequiredFields = useMemo(() => {
    const missing: string[] = [];
    if (selectedItems.length === 0) {
      missing.push("メニュー");
    }
    if (partySize <= 0) {
      missing.push("年齢構成");
    }
    if (
      fulfillmentType === "DINE_IN" &&
      (!tableNo.trim() || !Number.isInteger(parsedTableNo) || parsedTableNo <= 0)
    ) {
      missing.push("テーブル番号");
    }
    return missing;
  }, [fulfillmentType, parsedTableNo, partySize, selectedItems.length, tableNo]);
  const sliderMissingText =
    missingRequiredFields.length === 0
      ? null
      : missingRequiredFields.length === 1
        ? `${missingRequiredFields[0]}が未入力です`
        : "複数項目が未入力です";
  const sliderDisplayText =
    sliderErrorText ?? sliderMissingText ?? "スライドして注文を確定";
  const sliderTone: "green" | "red" = sliderErrorText ? "red" : "green";

  const changeQty = (menuId: string, delta: number) => {
    const menu = menuList.find((m) => m.id === menuId);
    if (!menu) {
      return;
    }
    if (
      delta > 0 &&
      menu.availability !== "AVAILABLE" &&
      menu.availability !== "INCREASED_WAIT"
    ) {
      return;
    }
    if (delta > 0) {
      const selected = cart[menuId] ?? 0;
      const remaining = menu.remainingUntilCap;
      if (remaining != null && selected >= remaining) {
        notify({
          level: "warning",
          message: `${menu.name} は本日の上限に達しています`,
        });
        return;
      }
    }

    setCart((prev) => {
      const next = (prev[menuId] ?? 0) + delta;
      const clone = { ...prev };
      if (next <= 0) {
        delete clone[menuId];
      } else {
        clone[menuId] = next;
      }
      return clone;
    });
  };

  const changeAgeGroup = (key: AgeGroupKey, delta: number) => {
    setAgeGroupCounts((prev) => {
      const next = Math.max(0, (prev[key] ?? 0) + delta);
      return {
        ...prev,
        [key]: next,
      };
    });
  };

  const updateMenuAvailability = async (
    menuId: string,
    next: "AVAILABLE" | "INCREASED_WAIT" | "PAUSED" | "SOLD_OUT",
  ) => {
    const menu = menuList.find((row) => row.id === menuId);
    if (!menu) {
      return;
    }

    if (
      (next === "AVAILABLE" || next === "INCREASED_WAIT") &&
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
      (next === "AVAILABLE" || next === "INCREASED_WAIT" || next === "PAUSED")
    ) {
      notify({
        level: "error",
        message: "本日の上限に達しているため変更できません",
      });
      return;
    }

    setMenuAvailabilityBusyId(menuId);

    try {
      await apiFetch("/api/admin/menus", {
        method: "PATCH",
        body: JSON.stringify({ id: menuId, availability: next }),
      });
      notify({
        level: "success",
        message: `${menu.name} を ${labelOf(AVAILABILITY_LABEL, next)} に変更しました`,
      });
      await loadMenus();
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "メニュー状態の更新に失敗しました",
      });
    } finally {
      setMenuAvailabilityBusyId(null);
    }
  };

  const submitOrder = async () => {
    if (awaitingOrder) {
      notify({
        level: "warning",
        message: `注文 #${awaitingOrder.orderNo} のSquare決済結果を待機中です`,
      });
      return;
    }

    if (selectedItems.length === 0) {
      notify({ level: "warning", message: "メニューを選択してください" });
      return;
    }
    if (partySize <= 0) {
      notify({ level: "warning", message: "年齢構成を入力してください" });
      return;
    }
    if (fulfillmentType === "DINE_IN") {
      if (
        !tableNo.trim() ||
        !Number.isInteger(parsedTableNo) ||
        parsedTableNo <= 0
      ) {
        notify({ level: "warning", message: "テーブル番号を入力してください" });
        return;
      }
    }

    setBusy(true);
    setSliderErrorText(null);

    try {
      const payload = {
        fulfillmentType,
        tableNo: fulfillmentType === "DINE_IN" ? parsedTableNo : null,
        partySize,
        ageRanges,
        specialNote: specialNote || undefined,
        paymentMethod,
        paymentSkipReasonType:
          paymentMethod === "PAYMENT_SKIPPED" ? skipReasonType : null,
        paymentSkipReasonText:
          paymentMethod === "PAYMENT_SKIPPED" ? skipReasonText || null : null,
        items: selectedItems.map((item) => ({
          menuId: item.id,
          quantity: item.quantity,
        })),
        idempotencyKey: newIdempotencyKey(),
      };

      const data = await apiFetch<{
        order: {
          id: string;
          orderNo: number;
          paymentStatus: string;
          orderStatus: string;
        };
        square: { deepLink: string } | null;
      }>("/api/orders", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      notify({
        level: "success",
        message: `注文 #${data.order.orderNo} を登録しました（${labelOf(PAYMENT_STATUS_LABEL, data.order.paymentStatus)} / ${labelOf(ORDER_STATUS_LABEL, data.order.orderStatus)}）`,
      });

      if (data.square?.deepLink) {
        notify({
          level: "info",
          message: `Square アプリ起動: ${data.square.deepLink}`,
        });
      }

      if (paymentMethod === "SQUARE") {
        setPendingSquareOrderId(data.order.id);
        scheduleDebugSimulation(data.order.id);
        await refreshPaymentState(data.order.id);
      } else {
        resetInputsToDefault();
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "注文登録に失敗しました";
      notify({
        level: "error",
        message: errorMessage,
      });
      setSliderErrorText(summarizeOrderErrorMessage(errorMessage));
      void refreshPaymentState().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !session) {
    return <LoadingScreen />;
  }

  const isAwaitingLocked = Boolean(awaitingOrder);
  const awaitingDeadlineLabel = awaitingOrder?.paymentAwaitDeadlineAt
    ? new Date(awaitingOrder.paymentAwaitDeadlineAt).toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

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
        // subtitle="注文登録と会計をリアルタイム運用"
        hideHeader
      >
        <div className="grid two">
          <Card
            className="card"
            style={isAwaitingLocked ? { opacity: 0.55, pointerEvents: "none" } : undefined}
          >
            <SectionTitle>メニュー</SectionTitle>
            <div className="menu-tile-grid">
              {menuList.map((menu) => {
                const qty = cart[menu.id] ?? 0;
                const remainingUntilCap = menu.remainingUntilCap;
                const unavailable =
                  menu.isCapReached ||
                  menu.availability !== "AVAILABLE" &&
                  menu.availability !== "INCREASED_WAIT";
                return (
                  <div
                    key={menu.id}
                    className={`menu-tile ${qty > 0 ? "selected" : ""} ${unavailable ? "unavailable" : ""}`}
                  >
                    <div className="row between">
                      <strong>{menu.name}</strong>
                      {menu.dailyOrderCap != null ? (
                        <span className="muted text-xs">
                          残り {remainingUntilCap ?? 0} / 上限 {menu.dailyOrderCap}
                        </span>
                      ) : null}
                    </div>
                    <div className="menu-tile-footer">
                      <span className="menu-tile-stat">
                        {fmtJpy(menu.priceJpy)}
                      </span>
                      <div
                        className="row"
                        style={{ justifyContent: "flex-end" }}
                      >
                        <button
                          className="ghost-btn"
                          type="button"
                          disabled={qty <= 0}
                          onClick={() => changeQty(menu.id, -1)}
                        >
                          -
                        </button>
                        <strong>{qty}</strong>
                        <button
                          className="ghost-btn"
                          type="button"
                          onClick={() => changeQty(menu.id, 1)}
                          disabled={
                            unavailable ||
                            (remainingUntilCap != null && qty >= remainingUntilCap)
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="menu-status-grid">
                      {AVAILABILITY_OPTIONS.map((option) => {
                        const noCoverageForAvailable =
                          (option === "AVAILABLE" ||
                            option === "INCREASED_WAIT") &&
                          !menu.hasActiveKitchenCoverage;
                        const capBlockedStatus =
                          menu.isCapReached &&
                          (option === "AVAILABLE" ||
                            option === "INCREASED_WAIT" ||
                            option === "PAUSED");
                        const disabled =
                          menuAvailabilityBusyId === menu.id || capBlockedStatus;
                        const active = menu.availability === option;

                        return (
                          <Button
                            key={option}
                            type="button"
                            variant={active ? "default" : "outline"}
                            disabled={disabled}
                            className={cn(
                              "h-8 px-2 text-[11px] font-semibold leading-none",
                              (noCoverageForAvailable || capBlockedStatus) &&
                                !active &&
                                "opacity-50",
                              active
                                ? STATUS_BUTTON_ACTIVE_TONE[option]
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
                              void updateMenuAvailability(menu.id, option);
                            }}
                          >
                            {labelOf(AVAILABILITY_LABEL, option)}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="card">
            <SectionTitle>注文内容</SectionTitle>

            {isAwaitingLocked && awaitingOrder && (
              <div className="notice error" style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 800 }}>
                  注文 #{awaitingOrder.orderNo} のSquare決済結果を待機中です
                </div>
                <div>
                  {awaitingDeadlineLabel
                    ? `タイムアウト目安: ${awaitingDeadlineLabel}`
                    : "タイムアウト目安を取得できませんでした"}
                </div>
                <div className="row wrap" style={{ marginTop: 8 }}>
                  <a href={awaitingOrder.reopenDeepLink} className="btn-link ghost-btn">
                    Square POSアプリを再表示
                  </a>
                </div>
              </div>
            )}

            {debugScenario !== "none" && (
              <div className="notice" style={{ marginBottom: 12 }}>
                DEBUGシナリオ: {debugScenario}（本番投入前にこのショートカット実装を削除してください）
              </div>
            )}

            {incidents.length > 0 && (
              <div className="notice error" style={{ marginBottom: 12 }}>
                決済異常通知あり: {incidents.length}件（詳細はオーダーブック上部）
              </div>
            )}

            <div
              style={
                isAwaitingLocked
                  ? { pointerEvents: "none", opacity: 0.55 }
                  : undefined
              }
            >
              <div className="list">
              {selectedItems.length === 0 && (
                <div className="muted">選択中のメニューはありません</div>
              )}
              {selectedItems.map((item) => (
                <div key={item.id} className="list-item row between">
                  <div>
                    {item.name} × {item.quantity}
                  </div>
                  <strong>{fmtJpy(item.priceJpy * item.quantity)}</strong>
                </div>
              ))}
              {paymentMethod === "PAYMENT_SKIPPED" && total > 0 && (
                <div className="list-item row between payment-skip-row">
                  <div>決済スキップ</div>
                  <strong>- {fmtJpy(total)}</strong>
                </div>
              )}
              </div>

              <div className="row between" style={{ marginTop: 12 }}>
                <span>合計</span>
                <strong className="grand-total">{fmtJpy(displayTotal)}</strong>
              </div>

              <div className="grid" style={{ marginTop: 12 }}>
                <label>
                  受け渡し
                  <Select
                    value={fulfillmentType}
                    onValueChange={(v) =>
                      setFulfillmentType(v as "DINE_IN" | "TAKEOUT")
                    }
                  >
                    <SelectTrigger className="bg-background text-foreground">
                      <SelectValue placeholder="受け渡し" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DINE_IN">
                        {labelOf(FULFILLMENT_LABEL, "DINE_IN")}
                      </SelectItem>
                      <SelectItem value="TAKEOUT">
                        {labelOf(FULFILLMENT_LABEL, "TAKEOUT")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>

              {fulfillmentType === "DINE_IN" && (
                <label>
                  テーブル番号
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={tableNo}
                    onChange={(e) => setTableNo(e.target.value)}
                  />
                </label>
              )}

              <div className="age-group-grid">
                {AGE_GROUPS.map((group) => (
                  <div className="age-group-row" key={group.key}>
                    <span>{group.label}</span>
                    <div className="row">
                      <button
                        className="ghost-btn"
                        type="button"
                        disabled={(ageGroupCounts[group.key] ?? 0) <= 0}
                        onClick={() => changeAgeGroup(group.key, -1)}
                      >
                        -
                      </button>
                      <strong>{ageGroupCounts[group.key]}</strong>
                      <button
                        className="ghost-btn"
                        type="button"
                        onClick={() => changeAgeGroup(group.key, 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <label>
                備考
                <textarea
                  rows={2}
                  value={specialNote}
                  onChange={(e) => setSpecialNote(e.target.value)}
                />
              </label>

              <label>
                決済方法
                <Select
                  value={paymentMethod}
                  onValueChange={(v) =>
                    setPaymentMethod(v as "CASH" | "SQUARE" | "PAYMENT_SKIPPED")
                  }
                >
                  <SelectTrigger className="bg-background text-foreground">
                    <SelectValue placeholder="決済方法" />
                  </SelectTrigger>
                  <SelectContent>
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
              </label>

              {paymentMethod === "PAYMENT_SKIPPED" && (
                <>
                  <label>
                    スキップ理由
                    <Select
                      value={skipReasonType}
                      onValueChange={(v) =>
                        setSkipReasonType(
                          v as
                            | "TEST"
                            | "DEVICE_ERROR"
                            | "NETWORK_ERROR"
                            | "OTHER",
                        )
                      }
                    >
                      <SelectTrigger className="bg-background text-foreground">
                        <SelectValue placeholder="スキップ理由" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TEST">
                          {labelOf(PAYMENT_SKIP_REASON_LABEL, "TEST")}
                        </SelectItem>
                        <SelectItem value="DEVICE_ERROR">
                          {labelOf(PAYMENT_SKIP_REASON_LABEL, "DEVICE_ERROR")}
                        </SelectItem>
                        <SelectItem value="NETWORK_ERROR">
                          {labelOf(PAYMENT_SKIP_REASON_LABEL, "NETWORK_ERROR")}
                        </SelectItem>
                        <SelectItem value="OTHER">
                          {labelOf(PAYMENT_SKIP_REASON_LABEL, "OTHER")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label>
                    詳細メモ
                    <Input
                      value={skipReasonText}
                      onChange={(e) => setSkipReasonText(e.target.value)}
                    />
                  </label>
                </>
              )}
              </div>

              <div className="row wrap" style={{ marginTop: 14 }}>
                <ConfirmSlider
                  disabled={busy || isAwaitingLocked || missingRequiredFields.length > 0}
                  text={sliderDisplayText}
                  tone={sliderTone}
                  processingText="注文を送信中..."
                  onConfirm={submitOrder}
                />
                <Link href="/order-book" className="btn-link ghost-btn">
                  オーダーブック
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </DashboardShell>
    </>
  );
}
