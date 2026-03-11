"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { Card, SectionTitle } from "@/components/ui";
import { TerminalBanner } from "@/components/terminal-banner";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";

type QueueItem = {
  id: string;
  name: string;
  orderId: string;
  orderNo: number;
  fulfillmentType: "DINE_IN" | "TAKEOUT";
  tableNo: number | null;
  specialNote: string | null;
  elapsed: string;
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

type Assignment = {
  menuId: string;
  kitchenId: string;
  enabled: boolean;
  menu: { id: string; name: string };
};

type Menu = { id: string; name: string; availability: "AVAILABLE" | "PAUSED" | "SOLD_OUT" };

export default function KitchenPage() {
  const { loading, session } = useSession(["KITCHEN"]);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [kitchens, setKitchens] = useState<KitchenActor[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetKitchenId, setTargetKitchenId] = useState<string>("");

  const myKitchenId = session?.actor.actorId ?? null;
  const reloadInFlightRef = useRef(false);

  const reload = async () => {
    if (reloadInFlightRef.current) {
      return;
    }
    reloadInFlightRef.current = true;

    try {
      const [queue, actorPayload, menuPayload, assignmentPayload] = await Promise.all([
        apiFetch<{ items: QueueItem[] }>("/api/kitchen/queue"),
        apiFetch<{ actors: KitchenActor[] }>("/api/admin/actors"),
        apiFetch<{ menus: Menu[] }>("/api/admin/menus"),
        apiFetch<{ assignments: Assignment[] }>("/api/admin/assignments")
      ]);

      setItems(queue.items);
      setKitchens(
        actorPayload.actors
          .filter((a) => a.actorType === "KITCHEN")
          .sort((a, b) => a.kitchenDisplayOrder - b.kitchenDisplayOrder || a.id.localeCompare(b.id))
      );
      setMenus(menuPayload.menus);
      setAssignments(assignmentPayload.assignments);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load kitchen data");
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
    channels: session
      ? ["orders", "menus", "actors", "assignments", `kitchen:${session.actor.actorId}`]
      : ["orders", "menus", "actors", "assignments"],
    onEvent: () => {
      void reload();
    },
    onResync: () => {
      void reload();
    }
  });

  const myKitchen = kitchens.find((k) => k.id === myKitchenId);

  const myMenus = useMemo(() => {
    const menuIds = new Set(assignments.filter((a) => a.kitchenId === myKitchenId && a.enabled).map((a) => a.menuId));
    return menus.filter((m) => menuIds.has(m.id));
  }, [assignments, menus, myKitchenId]);

  const markReady = async (itemId: string) => {
    try {
      await apiFetch(`/api/kitchen/items/${itemId}/ready`, {
        method: "POST",
        body: JSON.stringify({ expectedItemStatus: "QUEUED" })
      });
      setMessage("Item marked READY");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark READY");
    }
  };

  const undo = async () => {
    try {
      await apiFetch("/api/undo", {
        method: "POST",
        body: JSON.stringify({ confirm: true })
      });
      setMessage("Undo completed");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to undo");
    }
  };

  const toggleKitchen = async () => {
    if (!myKitchenId || !myKitchen) return;
    try {
      await apiFetch("/api/kitchen/toggle", {
        method: "POST",
        body: JSON.stringify({ kitchenId: myKitchenId, kitchenEnabled: !myKitchen.kitchenEnabled })
      });
      setMessage(`Kitchen ${!myKitchen.kitchenEnabled ? "enabled" : "disabled"}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle kitchen");
    }
  };

  const forceReassign = async () => {
    if (!myKitchenId || !targetKitchenId) return;
    try {
      await apiFetch("/api/kitchen/reassign", {
        method: "POST",
        body: JSON.stringify({ fromKitchenId: myKitchenId, toKitchenId: targetKitchenId })
      });
      setMessage("Queued items reassigned");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reassign items");
    }
  };

  const setAvailability = async (menuId: string, availability: "AVAILABLE" | "PAUSED" | "SOLD_OUT") => {
    try {
      await apiFetch("/api/kitchen/menu-availability", {
        method: "POST",
        body: JSON.stringify({ menuId, availability })
      });
      setMessage(`Menu availability set to ${availability}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update menu availability");
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
        inactiveKitchenWarnings={session.inactiveKitchenQueuedItems.map((x) => ({ kitchenName: x.kitchenName }))}
      />
      <main className="grid two">
        <Card>
          <SectionTitle>Kitchen Queue</SectionTitle>
          <div className="row wrap" style={{ marginBottom: 10 }}>
            <button onClick={undo} className="ghost-btn">Undo Last Action</button>
            <button onClick={toggleKitchen} className="ghost-btn">
              Kitchen: {myKitchen?.kitchenEnabled ? "Disable" : "Enable"}
            </button>
            <Link href="/order-book"><button className="ghost-btn">Order Book</button></Link>
          </div>

          <div className="list">
            {items.length === 0 && <div className="muted">No queued items.</div>}
            {items.map((item) => (
              <div key={item.id} className="list-item">
                <div className="row between wrap">
                  <div>
                    <strong>{item.name}</strong>
                    <div className="muted">
                      Order #{item.orderNo} / {item.fulfillmentType}
                      {item.tableNo ? ` / table ${item.tableNo}` : ""}
                    </div>
                  </div>
                  <div className="row wrap">
                    <span className="badge queued">queued</span>
                    <span className="muted">{item.elapsed}</span>
                    <button onClick={() => markReady(item.id)}>Ready</button>
                  </div>
                </div>
                {item.specialNote && <div className="notice" style={{ marginTop: 8 }}>{item.specialNote}</div>}
                {item.kitchenInactiveWarning && <div className="notice error">Assigned kitchen is inactive: {item.kitchenName}</div>}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>Kitchen / Menu Control</SectionTitle>
          <label>
            Reassign queued items to kitchen
            <select value={targetKitchenId} onChange={(e) => setTargetKitchenId(e.target.value)}>
              <option value="">Select</option>
              {kitchens
                .filter((kitchen) => kitchen.id !== myKitchenId)
                .map((kitchen) => (
                  <option key={kitchen.id} value={kitchen.id}>
                    {kitchen.label} ({kitchen.isActive && kitchen.kitchenEnabled ? "active" : "inactive"})
                  </option>
                ))}
            </select>
          </label>
          <div style={{ marginTop: 10 }}>
            <button onClick={forceReassign} className="ghost-btn" disabled={!targetKitchenId}>Force Reassign</button>
          </div>

          <hr style={{ margin: "18px 0", border: "none", borderTop: "1px solid #ddd" }} />

          <div className="list">
            {myMenus.map((menu) => (
              <div className="list-item" key={menu.id}>
                <div className="row between wrap">
                  <strong>{menu.name}</strong>
                  <span className="muted">{menu.availability}</span>
                </div>
                <div className="row wrap" style={{ marginTop: 8 }}>
                  <button className="ghost-btn" onClick={() => setAvailability(menu.id, "AVAILABLE")}>available</button>
                  <button className="ghost-btn" onClick={() => setAvailability(menu.id, "PAUSED")}>paused</button>
                  <button className="ghost-btn" onClick={() => setAvailability(menu.id, "SOLD_OUT")}>sold_out</button>
                </div>
              </div>
            ))}
          </div>

          {message && <div className="notice ok">{message}</div>}
          {error && <div className="notice error">{error}</div>}
        </Card>
      </main>
    </>
  );
}


