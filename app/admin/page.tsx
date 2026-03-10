"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { Card, SectionTitle } from "@/components/ui";
import { TerminalBanner } from "@/components/terminal-banner";

type Actor = {
  id: string;
  actorType: "POS" | "KITCHEN" | "WAITER" | "MENU_DISPLAY" | "ADMIN";
  lineId: string | null;
  label: string;
  isActive: boolean;
  online: boolean;
};

type Line = {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
};

type Category = {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
};

type Menu = {
  id: string;
  name: string;
  priceJpy: number;
  availability: "AVAILABLE" | "PAUSED" | "SOLD_OUT";
  workloadSeconds: number;
  displayOrder: number;
  categoryId: string;
  isActive: boolean;
};

type Assignment = {
  menuId: string;
  lineId: string;
  enabled: boolean;
};

export default function AdminPage() {
  const { loading, session } = useSession(["ADMIN"]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newActorId, setNewActorId] = useState("");
  const [newActorType, setNewActorType] = useState<Actor["actorType"]>("POS");
  const [newActorLineId, setNewActorLineId] = useState("");
  const [newActorLabel, setNewActorLabel] = useState("");
  const [newActorSecret, setNewActorSecret] = useState("");

  const [newLineId, setNewLineId] = useState("");
  const [newLineName, setNewLineName] = useState("");

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newMenuName, setNewMenuName] = useState("");
  const [newMenuPrice, setNewMenuPrice] = useState("500");
  const [newMenuCategoryId, setNewMenuCategoryId] = useState("");

  const reload = async () => {
    try {
      const [a, l, m, c, s] = await Promise.all([
        apiFetch<{ actors: Actor[] }>("/api/admin/actors"),
        apiFetch<{ lines: Line[] }>("/api/admin/lines"),
        apiFetch<{ menus: Menu[]; categories: Category[] }>("/api/admin/menus"),
        apiFetch<{ categories: Category[] }>("/api/admin/categories"),
        apiFetch<{ assignments: Assignment[] }>("/api/admin/assignments")
      ]);

      setActors(a.actors);
      setLines(l.lines);
      setMenus(m.menus);
      setCategories(c.categories);
      setAssignments(s.assignments);
      if (!newMenuCategoryId && c.categories.length > 0) {
        setNewMenuCategoryId(c.categories[0]!.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  };

  useEffect(() => {
    if (!session) return;
    reload();
    const timer = setInterval(reload, 6000);
    return () => clearInterval(timer);
  }, [session]);

  const createActor = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/admin/actors", {
        method: "POST",
        body: JSON.stringify({
          id: newActorId,
          actorType: newActorType,
          lineId: newActorType === "KITCHEN" ? newActorLineId : null,
          label: newActorLabel,
          secret: newActorSecret
        })
      });
      setMessage("端末IDを作成しました");
      setNewActorId("");
      setNewActorLabel("");
      setNewActorSecret("");
      await reload();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "actor create failed");
    }
  };

  const deactivateActor = async (id: string) => {
    try {
      await apiFetch(`/api/admin/actors?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setMessage(`${id} を無効化しました`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "actor delete failed");
    }
  };

  const forceLogout = async (id: string) => {
    try {
      await apiFetch("/api/admin/sessions/force-logout", {
        method: "POST",
        body: JSON.stringify({ actorId: id })
      });
      setMessage(`${id} を強制ログアウトしました`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "force logout failed");
    }
  };

  const createLine = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/admin/lines", {
        method: "POST",
        body: JSON.stringify({ id: newLineId, name: newLineName, displayOrder: lines.length + 1 })
      });
      setMessage("ラインを作成しました");
      setNewLineId("");
      setNewLineName("");
      await reload();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "line create failed");
    }
  };

  const toggleLine = async (line: Line) => {
    try {
      await apiFetch("/api/admin/lines", {
        method: "PATCH",
        body: JSON.stringify({ id: line.id, isActive: !line.isActive })
      });
      setMessage(`${line.name} を${line.isActive ? "無効" : "有効"}化しました`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "line toggle failed");
    }
  };

  const createCategory = async () => {
    try {
      await apiFetch("/api/admin/categories", {
        method: "POST",
        body: JSON.stringify({ name: newCategoryName, displayOrder: categories.length + 1 })
      });
      setNewCategoryName("");
      setMessage("カテゴリを作成しました");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "category create failed");
    }
  };

  const createMenu = async () => {
    try {
      await apiFetch("/api/admin/menus", {
        method: "POST",
        body: JSON.stringify({
          name: newMenuName,
          priceJpy: Number(newMenuPrice),
          availability: "PAUSED",
          workloadSeconds: 300,
          displayOrder: menus.length + 1,
          categoryId: newMenuCategoryId,
          showLeadTime: true
        })
      });
      setMessage("メニューを作成しました（初期はPAUSED）");
      setNewMenuName("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "menu create failed");
    }
  };

  const updateMenu = async (menu: Menu, patch: Partial<Menu>) => {
    try {
      await apiFetch("/api/admin/menus", {
        method: "PATCH",
        body: JSON.stringify({ id: menu.id, ...patch })
      });
      setMessage(`${menu.name} を更新しました`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "menu update failed");
    }
  };

  const toggleAssignment = async (menuId: string, lineId: string, enabled: boolean) => {
    try {
      await apiFetch("/api/admin/assignments", {
        method: "POST",
        body: JSON.stringify({ menuId, lineId, enabled })
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "assignment failed");
    }
  };

  const purge = async (target: "ORDERS" | "AUDIT_LOGS") => {
    const ok = window.confirm(`${target} を一括削除します。続行しますか？`);
    if (!ok) return;

    try {
      await apiFetch("/api/admin/purge", {
        method: "POST",
        body: JSON.stringify({ target, confirmationText: "DELETE" })
      });
      setMessage(`${target} を削除しました`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "purge failed");
    }
  };

  const assignmentMap = new Map(assignments.map((a) => [`${a.menuId}:${a.lineId}`, a.enabled]));

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
      <main className="grid">
        <div className="row between wrap">
          <h1 style={{ margin: 0 }}>Admin</h1>
          <div className="row wrap">
            <Link href="/order-book">
              <button className="ghost-btn">Order Book</button>
            </Link>
            <Link href="/audit">
              <button className="ghost-btn">Audit Log</button>
            </Link>
          </div>
        </div>

        {message && <div className="notice ok">{message}</div>}
        {error && <div className="notice error">{error}</div>}

        <div className="grid two">
          <Card>
            <SectionTitle>Actor Management</SectionTitle>
            <form onSubmit={createActor} className="grid">
              <input placeholder="actor id" value={newActorId} onChange={(e) => setNewActorId(e.target.value)} required />
              <select value={newActorType} onChange={(e) => setNewActorType(e.target.value as Actor["actorType"])}>
                <option value="POS">POS</option>
                <option value="KITCHEN">KITCHEN</option>
                <option value="WAITER">WAITER</option>
                <option value="MENU_DISPLAY">MENU_DISPLAY</option>
              </select>
              {newActorType === "KITCHEN" && (
                <select value={newActorLineId} onChange={(e) => setNewActorLineId(e.target.value)}>
                  <option value="">line を選択</option>
                  {lines.map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.name}
                    </option>
                  ))}
                </select>
              )}
              <input placeholder="label" value={newActorLabel} onChange={(e) => setNewActorLabel(e.target.value)} required />
              <input placeholder="secret" value={newActorSecret} onChange={(e) => setNewActorSecret(e.target.value)} required />
              <button>Create Actor</button>
            </form>

            <div className="list" style={{ marginTop: 12 }}>
              {actors.map((actor) => (
                <div key={actor.id} className="list-item row between wrap">
                  <div>
                    <strong>{actor.id}</strong>
                    <div className="muted">
                      {actor.actorType} / {actor.label}
                      {actor.lineId ? ` / line=${actor.lineId}` : ""}
                    </div>
                    <div className="muted">{actor.online ? "online" : "offline"}</div>
                  </div>
                  <div className="row wrap">
                    <button className="ghost-btn" onClick={() => forceLogout(actor.id)} disabled={!actor.isActive}>
                      Force Logout
                    </button>
                    {actor.id !== "admin" && (
                      <button className="ghost-btn" onClick={() => deactivateActor(actor.id)} disabled={!actor.isActive}>
                        Deactivate
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle>Line Management</SectionTitle>
            <form onSubmit={createLine} className="grid">
              <input placeholder="line id" value={newLineId} onChange={(e) => setNewLineId(e.target.value)} required />
              <input placeholder="line name" value={newLineName} onChange={(e) => setNewLineName(e.target.value)} required />
              <button>Create Line</button>
            </form>

            <div className="list" style={{ marginTop: 12 }}>
              {lines.map((line) => (
                <div key={line.id} className="list-item row between wrap">
                  <div>
                    <strong>{line.name}</strong>
                    <div className="muted">{line.id}</div>
                  </div>
                  <button className="ghost-btn" onClick={() => toggleLine(line)}>
                    {line.isActive ? "Disable" : "Enable"}
                  </button>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card>
          <SectionTitle>Menu / Category / Assignment</SectionTitle>
          <div className="grid two">
            <div>
              <div className="row wrap">
                <input
                  placeholder="new category"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  style={{ maxWidth: 220 }}
                />
                <button className="ghost-btn" onClick={createCategory} disabled={!newCategoryName}>
                  Add Category
                </button>
              </div>
              <div className="row wrap" style={{ marginTop: 8 }}>
                <input placeholder="new menu name" value={newMenuName} onChange={(e) => setNewMenuName(e.target.value)} style={{ maxWidth: 220 }} />
                <input placeholder="price" value={newMenuPrice} onChange={(e) => setNewMenuPrice(e.target.value)} style={{ maxWidth: 120 }} />
                <select value={newMenuCategoryId} onChange={(e) => setNewMenuCategoryId(e.target.value)} style={{ maxWidth: 220 }}>
                  <option value="">category</option>
                  {categories.filter((c) => c.isActive).map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
                <button className="ghost-btn" onClick={createMenu} disabled={!newMenuName || !newMenuCategoryId}>
                  Add Menu
                </button>
              </div>
            </div>
          </div>

          <div className="list" style={{ marginTop: 12 }}>
            {menus.map((menu) => (
              <div key={menu.id} className="list-item">
                <div className="row between wrap">
                  <div>
                    <strong>{menu.name}</strong>
                    <div className="muted">
                      {fmtJpy(menu.priceJpy)} / {menu.workloadSeconds}s / {menu.availability}
                    </div>
                  </div>
                  <div className="row wrap">
                    <button className="ghost-btn" onClick={() => updateMenu(menu, { availability: "AVAILABLE" })}>
                      AVAILABLE
                    </button>
                    <button className="ghost-btn" onClick={() => updateMenu(menu, { availability: "PAUSED" })}>
                      PAUSED
                    </button>
                    <button className="ghost-btn" onClick={() => updateMenu(menu, { availability: "SOLD_OUT" })}>
                      SOLD_OUT
                    </button>
                    <button className="ghost-btn" onClick={() => updateMenu(menu, { isActive: !menu.isActive })}>
                      {menu.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </div>

                <div className="row wrap" style={{ marginTop: 8 }}>
                  {lines.map((line) => {
                    const key = `${menu.id}:${line.id}`;
                    const enabled = assignmentMap.get(key) ?? false;
                    return (
                      <button
                        key={key}
                        className="ghost-btn"
                        onClick={() => toggleAssignment(menu.id, line.id, !enabled)}
                        style={{ borderColor: enabled ? "#111" : "#c0c0c0" }}
                      >
                        {line.name}: {enabled ? "ON" : "OFF"}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>Danger Zone</SectionTitle>
          <div className="row wrap">
            <button className="ghost-btn" onClick={() => purge("ORDERS")}>
              Purge Orders
            </button>
            <button className="ghost-btn" onClick={() => purge("AUDIT_LOGS")}>
              Purge Audit Logs
            </button>
          </div>
        </Card>
      </main>
    </>
  );
}


