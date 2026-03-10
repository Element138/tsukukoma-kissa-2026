"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { Card, SectionTitle } from "@/components/ui";
import { TerminalBanner } from "@/components/terminal-banner";

type QueueItem = {
  id: string;
  name: string;
  orderId: string;
  orderNo: number;
  fulfillmentType: "DINE_IN" | "TAKEOUT";
  tableNo: number | null;
  specialNote: string | null;
  elapsed: string;
  lineName: string;
  lineInactiveWarning: boolean;
};

type Line = { id: string; name: string; isActive: boolean };

type Assignment = {
  menuId: string;
  lineId: string;
  enabled: boolean;
  menu: { id: string; name: string };
};

type Menu = { id: string; name: string; availability: "AVAILABLE" | "PAUSED" | "SOLD_OUT" };

export default function KitchenPage() {
  const { loading, session } = useSession(["KITCHEN"]);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetLineId, setTargetLineId] = useState<string>("");

  const myLineId = session?.actor.lineId ?? null;

  const reload = async () => {
    try {
      const [queue, linePayload, menuPayload, assignmentPayload] = await Promise.all([
        apiFetch<{ items: QueueItem[] }>("/api/kitchen/queue"),
        apiFetch<{ lines: Line[] }>("/api/admin/lines"),
        apiFetch<{ menus: Menu[] }>("/api/admin/menus"),
        apiFetch<{ assignments: Assignment[] }>("/api/admin/assignments")
      ]);

      setItems(queue.items);
      setLines(linePayload.lines);
      setMenus(menuPayload.menus);
      setAssignments(assignmentPayload.assignments);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込み失敗");
    }
  };

  useEffect(() => {
    if (!session) {
      return;
    }
    reload();
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [session]);

  const myLine = lines.find((l) => l.id === myLineId);

  const myMenus = useMemo(() => {
    const menuIds = new Set(assignments.filter((a) => a.lineId === myLineId && a.enabled).map((a) => a.menuId));
    return menus.filter((m) => menuIds.has(m.id));
  }, [assignments, menus, myLineId]);

  const markReady = async (itemId: string) => {
    try {
      await apiFetch(`/api/kitchen/items/${itemId}/ready`, {
        method: "POST",
        body: JSON.stringify({ expectedItemStatus: "QUEUED" })
      });
      setMessage("Readyを反映しました");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ready失敗");
    }
  };

  const undo = async () => {
    try {
      await apiFetch("/api/undo", {
        method: "POST",
        body: JSON.stringify({ confirm: true })
      });
      setMessage("Undoを実行しました");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "undo失敗");
    }
  };

  const toggleLine = async () => {
    if (!myLineId || !myLine) {
      return;
    }
    try {
      await apiFetch("/api/kitchen/line/toggle", {
        method: "POST",
        body: JSON.stringify({ lineId: myLineId, isActive: !myLine.isActive })
      });
      setMessage(`ラインを${!myLine.isActive ? "有効" : "無効"}化しました`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "line切替失敗");
    }
  };

  const forceReassign = async () => {
    if (!myLineId || !targetLineId) {
      return;
    }
    try {
      await apiFetch("/api/kitchen/reassign", {
        method: "POST",
        body: JSON.stringify({ fromLineId: myLineId, toLineId: targetLineId })
      });
      setMessage("queued item を再割当しました");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "再割当失敗");
    }
  };

  const setAvailability = async (menuId: string, availability: "AVAILABLE" | "PAUSED" | "SOLD_OUT") => {
    try {
      await apiFetch("/api/kitchen/menu-availability", {
        method: "POST",
        body: JSON.stringify({ menuId, availability })
      });
      setMessage(`メニュー状態を ${availability} に更新しました`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "メニュー状態更新失敗");
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
          <SectionTitle>Kitchen Queue</SectionTitle>
          <div className="row wrap" style={{ marginBottom: 10 }}>
            <button onClick={undo} className="ghost-btn">
              Undo Last Action
            </button>
            <button onClick={toggleLine} className="ghost-btn">
              Line: {myLine?.isActive ? "Disable" : "Enable"}
            </button>
            <Link href="/order-book">
              <button className="ghost-btn">Order Book</button>
            </Link>
          </div>

          <div className="list">
            {items.length === 0 && <div className="muted">未完了itemはありません</div>}
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
                {item.lineInactiveWarning && <div className="notice error">割当ラインが無効です: {item.lineName}</div>}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>Line / Menu Control</SectionTitle>
          <label>
            Reassign queued items to line
            <select value={targetLineId} onChange={(e) => setTargetLineId(e.target.value)}>
              <option value="">選択</option>
              {lines
                .filter((line) => line.id !== myLineId)
                .map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.name} ({line.isActive ? "active" : "inactive"})
                  </option>
                ))}
            </select>
          </label>
          <div style={{ marginTop: 10 }}>
            <button onClick={forceReassign} className="ghost-btn" disabled={!targetLineId}>
              Force Reassign
            </button>
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


