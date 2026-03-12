"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { Card, SectionTitle } from "@/components/ui";
import { TerminalBanner } from "@/components/terminal-banner";
import { ConfirmSlider } from "@/components/confirm-slider";
import {
  AVAILABILITY_LABEL,
  FULFILLMENT_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_SKIP_REASON_LABEL,
  PAYMENT_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  labelOf
} from "@/lib/labels";
import { useToast } from "@/components/toast";

type MenuPayload = {
  menus: Array<{
    id: string;
    name: string;
    priceJpy: number;
    availability: "AVAILABLE" | "PAUSED" | "SOLD_OUT";
    isActive: boolean;
    categoryId: string;
    displayOrder: number;
    hasActiveKitchenCoverage: boolean;
  }>;
  categories: Array<{
    id: string;
    name: string;
    displayOrder: number;
  }>;
};

const AVAILABILITY_OPTIONS: Array<"AVAILABLE" | "PAUSED" | "SOLD_OUT"> = ["AVAILABLE", "PAUSED", "SOLD_OUT"];

const AGE_GROUPS = [
  { key: "infant", label: "0-6歳" },
  { key: "child", label: "7-12歳" },
  { key: "teen", label: "13-19歳" },
  { key: "adult", label: "20-64歳" },
  { key: "senior", label: "65歳以上" }
] as const;

type AgeGroupKey = (typeof AGE_GROUPS)[number]["key"];

function newIdempotencyKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export default function PosPage() {
  const { loading, session } = useSession(["POS"]);
  const { notify } = useToast();

  const [menus, setMenus] = useState<MenuPayload | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});

  const [fulfillmentType, setFulfillmentType] = useState<"DINE_IN" | "TAKEOUT">("DINE_IN");
  const [tableNo, setTableNo] = useState<string>("1");
  const [ageGroupCounts, setAgeGroupCounts] = useState<Record<AgeGroupKey, number>>({
    infant: 0,
    child: 0,
    teen: 0,
    adult: 1,
    senior: 0
  });
  const [specialNote, setSpecialNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "SQUARE" | "PAYMENT_SKIPPED">("CASH");
  const [skipReasonType, setSkipReasonType] = useState<"TEST" | "DEVICE_ERROR" | "NETWORK_ERROR" | "OTHER">("TEST");
  const [skipReasonText, setSkipReasonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuAvailabilityBusyId, setMenuAvailabilityBusyId] = useState<string | null>(null);

  const loadMenus = async () => {
    const data = await apiFetch<MenuPayload>("/api/admin/menus");
    setMenus(data);
  };

  useEffect(() => {
    if (!session) {
      return;
    }

    loadMenus().catch((e) => notify({ level: "error", message: e.message }));
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
        const categoryDiff = (categoryOrderMap.get(a.categoryId) ?? 9999) - (categoryOrderMap.get(b.categoryId) ?? 9999);
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

  const total = selectedItems.reduce((sum, item) => sum + item.priceJpy * item.quantity, 0);
  const displayTotal = paymentMethod === "PAYMENT_SKIPPED" ? 0 : total;
  const partySize = AGE_GROUPS.reduce((sum, group) => sum + (ageGroupCounts[group.key] ?? 0), 0);

  const ageRanges = useMemo(() => {
    return AGE_GROUPS.flatMap((group) => Array.from({ length: ageGroupCounts[group.key] ?? 0 }, () => group.label));
  }, [ageGroupCounts]);

  const changeQty = (menuId: string, delta: number) => {
    const menu = menuList.find((m) => m.id === menuId);
    if (!menu) {
      return;
    }
    if (delta > 0 && menu.availability !== "AVAILABLE") {
      return;
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
        [key]: next
      };
    });
  };

  const updateMenuAvailability = async (menuId: string, next: "AVAILABLE" | "PAUSED" | "SOLD_OUT") => {
    const menu = menuList.find((row) => row.id === menuId);
    if (!menu) {
      return;
    }

    if (next === "AVAILABLE" && !menu.hasActiveKitchenCoverage) {
      notify({ level: "error", message: "現在対応できるキッチンがないため、販売中にできません" });
      return;
    }

    setMenuAvailabilityBusyId(menuId);

    try {
      await apiFetch("/api/admin/menus", {
        method: "PATCH",
        body: JSON.stringify({ id: menuId, availability: next })
      });
      notify({ level: "success", message: `${menu.name} を ${labelOf(AVAILABILITY_LABEL, next)} に変更しました` });
      await loadMenus();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "メニュー状態の更新に失敗しました" });
    } finally {
      setMenuAvailabilityBusyId(null);
    }
  };

  const submitOrder = async () => {
    if (selectedItems.length === 0) {
      notify({ level: "warning", message: "メニューを選択してください" });
      return;
    }
    if (partySize <= 0) {
      notify({ level: "warning", message: "年齢構成を入力してください" });
      return;
    }

    setBusy(true);

    try {
      const payload = {
        fulfillmentType,
        tableNo: fulfillmentType === "DINE_IN" ? Number(tableNo) : null,
        partySize,
        ageRanges,
        specialNote: specialNote || undefined,
        paymentMethod,
        paymentSkipReasonType: paymentMethod === "PAYMENT_SKIPPED" ? skipReasonType : null,
        paymentSkipReasonText: paymentMethod === "PAYMENT_SKIPPED" ? skipReasonText || null : null,
        items: selectedItems.map((item) => ({ menuId: item.id, quantity: item.quantity })),
        idempotencyKey: newIdempotencyKey()
      };

      const data = await apiFetch<{
        order: { orderNo: number; paymentStatus: string; orderStatus: string };
        square: { deepLink: string } | null;
      }>("/api/orders", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      notify({
        level: "success",
        message: `注文 #${data.order.orderNo} を登録しました（${labelOf(PAYMENT_STATUS_LABEL, data.order.paymentStatus)} / ${labelOf(ORDER_STATUS_LABEL, data.order.orderStatus)}）`
      });

      if (data.square?.deepLink) {
        notify({ level: "info", message: `Square アプリ起動: ${data.square.deepLink}` });
      }

      setCart({});
      setSpecialNote("");
      setSkipReasonText("");
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "注文登録に失敗しました" });
    } finally {
      setBusy(false);
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
          <SectionTitle>メニュー</SectionTitle>
          <div className="menu-tile-grid">
            {menuList.map((menu) => {
              const qty = cart[menu.id] ?? 0;
              const unavailable = menu.availability !== "AVAILABLE";
              return (
                <div key={menu.id} className={`menu-tile ${qty > 0 ? "selected" : ""} ${unavailable ? "unavailable" : ""}`}>
                  <div className="row between">
                    <strong>{menu.name}</strong>
                  </div>
                  <div className="menu-tile-footer">
                    <span className="menu-tile-stat">{fmtJpy(menu.priceJpy)}</span>
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <button className="ghost-btn" type="button" onClick={() => changeQty(menu.id, -1)}>
                        -
                      </button>
                      <strong>{qty}</strong>
                      <button className="ghost-btn" type="button" onClick={() => changeQty(menu.id, 1)} disabled={unavailable}>
                        +
                      </button>
                    </div>
                  </div>
                  <div className="menu-status-grid">
                    {AVAILABILITY_OPTIONS.map((option) => {
                      const noCoverageForAvailable = option === "AVAILABLE" && !menu.hasActiveKitchenCoverage;
                      const pseudoDisabled = noCoverageForAvailable || menuAvailabilityBusyId === menu.id;

                      return (
                        <button
                          key={option}
                          type="button"
                          className={`ghost-btn status-btn ${menu.availability === option ? `status-${option.toLowerCase()} active` : ""}`}
                          aria-disabled={pseudoDisabled ? "true" : undefined}
                          onClick={() => {
                            if (pseudoDisabled) {
                              if (noCoverageForAvailable) {
                                notify({ level: "error", message: "現在対応できるキッチンがないため、販売中にできません" });
                              }
                              return;
                            }
                            void updateMenuAvailability(menu.id, option);
                          }}
                        >
                          {labelOf(AVAILABILITY_LABEL, option)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <SectionTitle>注文内容</SectionTitle>
          <div className="list">
            {selectedItems.length === 0 && <div className="muted">選択中のメニューはありません</div>}
            {selectedItems.map((item) => (
              <div key={item.id} className="list-item row between">
                <div>
                  {item.name} x {item.quantity}
                </div>
                <strong>{fmtJpy(item.priceJpy * item.quantity)}</strong>
              </div>
            ))}
            {paymentMethod === "PAYMENT_SKIPPED" && total > 0 && (
              <div className="list-item" style={{ borderColor: "#d18a8a", background: "#fff4f4", color: "#8f1f1f", fontWeight: 700 }}>
                スキップ控除, - {fmtJpy(total)}
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
              <select value={fulfillmentType} onChange={(e) => setFulfillmentType(e.target.value as "DINE_IN" | "TAKEOUT")}>
                <option value="DINE_IN">{labelOf(FULFILLMENT_LABEL, "DINE_IN")}</option>
                <option value="TAKEOUT">{labelOf(FULFILLMENT_LABEL, "TAKEOUT")}</option>
              </select>
            </label>

            {fulfillmentType === "DINE_IN" && (
              <label>
                テーブル番号
                <input value={tableNo} onChange={(e) => setTableNo(e.target.value)} />
              </label>
            )}

            <div className="age-group-grid">
              {AGE_GROUPS.map((group) => (
                <div className="age-group-row" key={group.key}>
                  <span>{group.label}</span>
                  <div className="row">
                    <button className="ghost-btn" type="button" onClick={() => changeAgeGroup(group.key, -1)}>
                      -
                    </button>
                    <strong>{ageGroupCounts[group.key]}</strong>
                    <button className="ghost-btn" type="button" onClick={() => changeAgeGroup(group.key, 1)}>
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <label>
              備考
              <textarea rows={2} value={specialNote} onChange={(e) => setSpecialNote(e.target.value)} />
            </label>

            <label>
              決済方法
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "CASH" | "SQUARE" | "PAYMENT_SKIPPED")}>
                <option value="CASH">{labelOf(PAYMENT_METHOD_LABEL, "CASH")}</option>
                <option value="SQUARE">{labelOf(PAYMENT_METHOD_LABEL, "SQUARE")}</option>
                <option value="PAYMENT_SKIPPED">{labelOf(PAYMENT_METHOD_LABEL, "PAYMENT_SKIPPED")}</option>
              </select>
            </label>

            {paymentMethod === "PAYMENT_SKIPPED" && (
              <>
                <label>
                  スキップ理由
                  <select value={skipReasonType} onChange={(e) => setSkipReasonType(e.target.value as "TEST" | "DEVICE_ERROR" | "NETWORK_ERROR" | "OTHER")}>
                    <option value="TEST">{labelOf(PAYMENT_SKIP_REASON_LABEL, "TEST")}</option>
                    <option value="DEVICE_ERROR">{labelOf(PAYMENT_SKIP_REASON_LABEL, "DEVICE_ERROR")}</option>
                    <option value="NETWORK_ERROR">{labelOf(PAYMENT_SKIP_REASON_LABEL, "NETWORK_ERROR")}</option>
                    <option value="OTHER">{labelOf(PAYMENT_SKIP_REASON_LABEL, "OTHER")}</option>
                  </select>
                </label>
                <label>
                  詳細メモ
                  <input value={skipReasonText} onChange={(e) => setSkipReasonText(e.target.value)} />
                </label>
              </>
            )}
          </div>

          <div className="row wrap" style={{ marginTop: 14 }}>
            <ConfirmSlider
              disabled={busy || selectedItems.length === 0 || partySize <= 0}
              text="スライドして注文を確定"
              processingText="注文を送信中..."
              onConfirm={submitOrder}
            />
            <Link href="/order-book" className="btn-link ghost-btn">
              オーダーブック
            </Link>
          </div>
        </Card>
      </main>
    </>
  );
}


