"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { useWakeLock } from "@/components/use-wake-lock";
import { useToast } from "@/components/toast";
import { Card } from "@/components/ui/card";

type CounterOrder = {
  id: string; orderNo: number; createdAt: string;
  fulfillmentType: "DINE_IN" | "TAKEOUT";
  specialNote: string | null;
  lastCalledAt: string | null;
  readyItems: Array<{ id: string; name: string }>;
  servedItemGroups: Array<{ name: string; count: number }>;
  unreadyItemGroups: Array<{ name: string; count: number }>;
};
type Stock = { menuId: string; name: string; count: number };
export default function CounterPage() {
  const { loading, session } = useSession(["WAITER"]);
  const { notify } = useToast();
  useWakeLock(Boolean(session));
  const [orders, setOrders] = useState<CounterOrder[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [tickNow, setTickNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const actionInFlight = useRef(false);
  const reloadInFlight = useRef(false);
  const reloadQueued = useRef(false);
  const reload = async () => {
    if (reloadInFlight.current) { reloadQueued.current = true; return; }
    reloadInFlight.current = true;
    try {
      const data = await apiFetch<{ orders: CounterOrder[]; stock: Stock[] }>("/api/counter/targets");
      setOrders(data.orders); setStock(data.stock);
    } catch (e) { notify({ level: "error", message: e instanceof Error ? e.message : "更新に失敗しました" }); }
    finally { reloadInFlight.current = false; if (reloadQueued.current) { reloadQueued.current = false; void reload(); } }
  };
  useEffect(() => { if (session) void reload(); }, [session]);
  useEffect(() => { const timer = setInterval(() => setTickNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useRealtimeSubscription({ enabled: Boolean(session), channels: ["orders", "counter"], onEvent: () => { void reload(); }, onResync: () => { void reload(); }, fallbackIntervalMs: 15000 });
  const perform = async (action: () => Promise<void>) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true; setBusy(true);
    try { await action(); await reload(); }
    catch (e) { notify({ level: "error", message: e instanceof Error ? e.message : "操作に失敗しました" }); await reload(); }
    finally { actionInFlight.current = false; setBusy(false); }
  };
  const call = (order: CounterOrder) => {
    const cancel = Boolean(order.lastCalledAt);
    if (!window.confirm(`オーダー #${order.orderNo} ${cancel ? "の呼び出しを解除しますか？" : "を呼び出しますか？"}`)) return;
    void perform(async () => {
      await apiFetch("/api/counter/call", { method: "POST", body: JSON.stringify({ orderId: order.id, action: cancel ? "cancel" : "call", confirm: true, idempotencyKey: crypto.randomUUID() }) });
      notify({ level: "success", message: `オーダー #${order.orderNo} ${cancel ? "の呼び出しを解除しました" : "を呼び出しました"}` });
    });
  };
  const serve = (item: { id: string; name: string }) => {
    void perform(async () => {
      const submit = (confirmUncalled: boolean) => apiFetch("/api/counter/serve-item", { method: "POST", body: JSON.stringify({ orderItemId: item.id, confirmUncalled }) });
      try { await submit(false); }
      catch (e) {
        if (!(e instanceof ApiError) || e.code !== "SERVE_CONFIRM_REQUIRED") throw e;
        if (!window.confirm(e.message.replace(/（コード:[\s\S]*$/, ""))) return;
        await submit(true);
      }
      notify({ level: "success", message: `「${item.name}」を提供済みにしました` });
    });
  };
  const undo = () => { void perform(async () => {
    await apiFetch("/api/undo", { method: "POST", body: JSON.stringify({ confirm: true }) });
    notify({ level: "success", message: "提供を取り消しました" });
  }); };
  if (loading || !session) return <LoadingScreen />;
  return <>
    <TerminalBanner actorId={session.actor.actorId} actorType={session.actor.actorType} actorLabel={session.actor.label} offlineActors={session.offlineActors} />
    <DashboardShell title="カウンター" hideHeader>
      <Card className="card counter-panel">
        <div className="row between wrap" style={{ marginBottom: 10 }}><h2 className="section-title text-base font-semibold">カウンタービュー</h2><button type="button" className="ghost-btn" disabled={busy} onClick={undo}>取り消し</button></div>
        {(["DINE_IN", "TAKEOUT"] as const).map(type => <section key={type}>
          <h3 style={{ margin: "14px 0 10px" }}>{type === "DINE_IN" ? "店内" : "持ち帰り"}</h3>
          <div className="counter-tile-grid">
            {!orders.some(o => o.fulfillmentType === type) && <div className="muted">提供可能なオーダーはありません</div>}
            {orders.filter(o => o.fulfillmentType === type).map(order => {
              const seconds = Math.max(0, Math.floor((tickNow - new Date(order.createdAt).getTime()) / 1000));
              const tone = seconds >= 600 ? "danger" : seconds >= 240 ? "warn" : "safe";
              return <article key={order.id} className={`counter-tile ${tone}`}>
                <div className="counter-tile-head">
                  <div className="counter-major"><span className="counter-major-label">注文番号</span><span className="counter-major-value">{order.orderNo}</span></div>
                  <button type="button" className="order-call-btn" aria-pressed={Boolean(order.lastCalledAt)} disabled={busy} onClick={() => call(order)}>{order.lastCalledAt ? "呼び出し解除" : "呼び出す"}</button>
                </div>
                <div className="muted counter-tile-elapsed">注文から {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</div>
                <div className="list counter-ready-list">
                  {order.readyItems.map(item => <div key={item.id} className="list-item row between wrap" style={{ padding: "8px 10px" }}>
                    <span>{item.name}</span><button type="button" className="ghost-btn counter-serve-btn" disabled={busy} onClick={() => serve(item)}>提供</button>
                  </div>)}
                  {order.servedItemGroups.map(group => <div key={`served-${group.name}`} className="list-item counter-item-muted" style={{ padding: "8px 10px" }}><span>{group.count > 1 ? `${group.count} × ` : ""}{group.name}</span><span className="badge served">提供済</span></div>)}
                  {order.unreadyItemGroups.map(group => <div key={`unready-${group.name}`} className="list-item counter-item-muted" style={{ padding: "8px 10px" }}><span>{group.count > 1 ? `${group.count} × ` : ""}{group.name}</span><span className="badge queued">調理中</span></div>)}
                </div>
                {order.specialNote && <div className="notice" style={{ marginTop: 8 }}>{order.specialNote}</div>}
              </article>;
            })}
          </div>
        </section>)}
      </Card>
    </DashboardShell>
    <div className={`counter-stock-bar ${stock.length > 0 ? "is-visible" : ""}`} aria-hidden={stock.length === 0}>
      <strong>提供可能</strong>{stock.map(s => <span key={s.menuId}>{s.name} <b>{s.count}</b> 個</span>)}
    </div>
  </>;
}
