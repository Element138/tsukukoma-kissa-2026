"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { Card, SectionTitle } from "@/components/ui";
import { TerminalBanner } from "@/components/terminal-banner";

type MenuPayload = {
  menus: Array<{
    id: string;
    name: string;
    priceJpy: number;
    availability: "AVAILABLE" | "PAUSED" | "SOLD_OUT";
    isActive: boolean;
    categoryId: string;
  }>;
  categories: Array<{
    id: string;
    name: string;
  }>;
};

export default function PosPage() {
  const { loading, session } = useSession(["POS"]);
  const [menus, setMenus] = useState<MenuPayload | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [fulfillmentType, setFulfillmentType] = useState<"DINE_IN" | "TAKEOUT">("DINE_IN");
  const [tableNo, setTableNo] = useState<string>("1");
  const [partySize, setPartySize] = useState<string>("1");
  const [ageRangesText, setAgeRangesText] = useState<string>("adult");
  const [specialNote, setSpecialNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "SQUARE" | "PAYMENT_SKIPPED">("CASH");
  const [skipReasonType, setSkipReasonType] = useState<"TEST" | "DEVICE_ERROR" | "NETWORK_ERROR" | "OTHER">("TEST");
  const [skipReasonText, setSkipReasonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      return;
    }
    apiFetch<MenuPayload>("/api/admin/menus")
      .then(setMenus)
      .catch((e) => setError(e.message));
  }, [session]);

  const menuList = useMemo(() => {
    if (!menus) {
      return [] as MenuPayload["menus"];
    }
    return menus.menus.filter((m) => m.isActive && m.availability === "AVAILABLE");
  }, [menus]);

  const selectedItems = useMemo(() => {
    return menuList
      .map((m) => ({ ...m, quantity: cart[m.id] ?? 0 }))
      .filter((m) => m.quantity > 0);
  }, [menuList, cart]);

  const total = selectedItems.reduce((sum, item) => sum + item.priceJpy * item.quantity, 0);

  const changeQty = (menuId: string, delta: number) => {
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

  const submitOrder = async () => {
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const payload = {
        fulfillmentType,
        tableNo: fulfillmentType === "DINE_IN" ? Number(tableNo) : null,
        partySize: Number(partySize),
        ageRanges: ageRangesText
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        specialNote: specialNote || undefined,
        paymentMethod,
        paymentSkipReasonType: paymentMethod === "PAYMENT_SKIPPED" ? skipReasonType : null,
        paymentSkipReasonText: paymentMethod === "PAYMENT_SKIPPED" ? skipReasonText || null : null,
        items: selectedItems.map((item) => ({ menuId: item.id, quantity: item.quantity })),
        idempotencyKey: `${Date.now()}-${Math.random().toString(16).slice(2)}`
      };

      const data = await apiFetch<{
        order: { orderNo: number; paymentStatus: string; orderStatus: string };
        square: { deepLink: string } | null;
      }>("/api/orders", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      const msg = `注文 #${data.order.orderNo} / payment=${data.order.paymentStatus} / status=${data.order.orderStatus}`;
      if (data.square?.deepLink) {
        setResult(`${msg}\nSquare App Switch: ${data.square.deepLink}`);
      } else {
        setResult(msg);
      }

      setCart({});
      setSpecialNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "注文作成に失敗しました");
    } finally {
      setBusy(false);
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
          <SectionTitle>POS / Menu Tiles</SectionTitle>
          <div className="menu-tile-grid">
            {menuList.map((m) => {
              const qty = cart[m.id] ?? 0;
              return (
                <div key={m.id} className={`menu-tile ${qty > 0 ? "selected" : ""}`}>
                  <div>
                    <strong>{m.name}</strong>
                    <div className="muted">{fmtJpy(m.priceJpy)}</div>
                  </div>
                  <div className="row">
                    <button className="ghost-btn" onClick={() => changeQty(m.id, -1)}>
                      -
                    </button>
                    <strong>{qty}</strong>
                    <button className="ghost-btn" onClick={() => changeQty(m.id, 1)}>
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <SectionTitle>Order + Payment</SectionTitle>
          <div className="list">
            {selectedItems.length === 0 && <div className="muted">メニュー未選択</div>}
            {selectedItems.map((item) => (
              <div key={item.id} className="list-item row between">
                <div>
                  {item.name} x {item.quantity}
                </div>
                <strong>{fmtJpy(item.priceJpy * item.quantity)}</strong>
              </div>
            ))}
          </div>

          <div className="row between" style={{ marginTop: 12 }}>
            <span>Total</span>
            <strong>{fmtJpy(total)}</strong>
          </div>

          <div className="grid" style={{ marginTop: 12 }}>
            <label>
              Fulfillment
              <select value={fulfillmentType} onChange={(e) => setFulfillmentType(e.target.value as any)}>
                <option value="DINE_IN">DINE_IN</option>
                <option value="TAKEOUT">TAKEOUT</option>
              </select>
            </label>

            {fulfillmentType === "DINE_IN" && (
              <label>
                Table No
                <input value={tableNo} onChange={(e) => setTableNo(e.target.value)} />
              </label>
            )}

            <label>
              Party Size
              <input value={partySize} onChange={(e) => setPartySize(e.target.value)} />
            </label>

            <label>
              Age Ranges (comma separated)
              <input value={ageRangesText} onChange={(e) => setAgeRangesText(e.target.value)} placeholder="adult,child" />
            </label>

            <label>
              Special Note
              <textarea rows={2} value={specialNote} onChange={(e) => setSpecialNote(e.target.value)} />
            </label>

            <label>
              Payment Method
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)}>
                <option value="CASH">cash</option>
                <option value="SQUARE">square</option>
                <option value="PAYMENT_SKIPPED">payment_skipped</option>
              </select>
            </label>

            {paymentMethod === "PAYMENT_SKIPPED" && (
              <>
                <label>
                  Skip Reason Type
                  <select value={skipReasonType} onChange={(e) => setSkipReasonType(e.target.value as any)}>
                    <option value="TEST">TEST</option>
                    <option value="DEVICE_ERROR">DEVICE_ERROR</option>
                    <option value="NETWORK_ERROR">NETWORK_ERROR</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </label>
                <label>
                  Skip Reason Text
                  <input value={skipReasonText} onChange={(e) => setSkipReasonText(e.target.value)} />
                </label>
              </>
            )}
          </div>

          <div className="row wrap" style={{ marginTop: 14 }}>
            <button disabled={busy || selectedItems.length === 0} onClick={submitOrder}>
              {busy ? "Processing..." : "決済開始（注文確定）"}
            </button>
            <Link href="/order-book">
              <button className="ghost-btn">Order Book</button>
            </Link>
          </div>

          {result && (
            <div className="notice ok" style={{ whiteSpace: "pre-wrap" }}>
              {result}
            </div>
          )}
          {error && <div className="notice error">{error}</div>}
        </Card>
      </main>
    </>
  );
}


