"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { Card, SectionTitle } from "@/components/ui";
import { TerminalBanner } from "@/components/terminal-banner";

type Actor = {
  id: string;
  actorType: "POS" | "KITCHEN" | "WAITER" | "MENU_DISPLAY" | "ADMIN";
  label: string;
  isActive: boolean;
  online: boolean;
  kitchenEnabled: boolean;
  kitchenDisplayOrder: number;
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
  kitchenId: string;
  enabled: boolean;
};

export default function AdminPage() {
  const { loading, session } = useSession(["ADMIN"]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newActorId, setNewActorId] = useState("");
  const [newActorType, setNewActorType] = useState<Actor["actorType"]>("POS");
  const [newActorLabel, setNewActorLabel] = useState("");
  const [newActorSecret, setNewActorSecret] = useState("");
  const [newKitchenDisplayOrder, setNewKitchenDisplayOrder] = useState("0");

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newMenuName, setNewMenuName] = useState("");
  const [newMenuPrice, setNewMenuPrice] = useState("500");
  const [newMenuCategoryId, setNewMenuCategoryId] = useState("");

  const kitchenActors = useMemo(
    () => actors.filter((a) => a.actorType === "KITCHEN").sort((a, b) => a.kitchenDisplayOrder - b.kitchenDisplayOrder || a.id.localeCompare(b.id)),
    [actors]
  );

  const reload = async () => {
    try {
      const [actorRes, menuRes, categoryRes, assignmentRes] = await Promise.all([
        apiFetch<{ actors: Actor[] }>("/api/admin/actors"),
        apiFetch<{ menus: Menu[]; categories: Category[] }>("/api/admin/menus"),
        apiFetch<{ categories: Category[] }>("/api/admin/categories"),
        apiFetch<{ assignments: Assignment[] }>("/api/admin/assignments")
      ]);

      setActors(actorRes.actors);
      setMenus(menuRes.menus);
      setCategories(categoryRes.categories);
      setAssignments(assignmentRes.assignments);

      if (!newMenuCategoryId && categoryRes.categories.length > 0) {
        setNewMenuCategoryId(categoryRes.categories[0]!.id);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load admin data");
    }
  };

  useEffect(() => {
    if (!session) return;
    reload();
    const timer = setInterval(reload, 6000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const createActor = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/admin/actors", {
        method: "POST",
        body: JSON.stringify({
          id: newActorId,
          actorType: newActorType,
          label: newActorLabel,
          secret: newActorSecret,
          ...(newActorType === "KITCHEN"
            ? {
                kitchenEnabled: true,
                kitchenDisplayOrder: Number(newKitchenDisplayOrder)
              }
            : {})
        })
      });
      setMessage("Actor created");
      setNewActorId("");
      setNewActorLabel("");
      setNewActorSecret("");
      setNewKitchenDisplayOrder("0");
      await reload();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Failed to create actor");
    }
  };

  const deactivateActor = async (id: string) => {
    try {
      await apiFetch(`/api/admin/actors?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setMessage(`Actor ${id} deactivated`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to deactivate actor");
    }
  };

  const forceLogout = async (id: string) => {
    try {
      await apiFetch("/api/admin/sessions/force-logout", {
        method: "POST",
        body: JSON.stringify({ actorId: id })
      });
      setMessage(`Forced logout: ${id}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to force logout");
    }
  };

  const toggleKitchenEnabled = async (kitchenActor: Actor) => {
    try {
      await apiFetch("/api/kitchen/toggle", {
        method: "POST",
        body: JSON.stringify({
          kitchenId: kitchenActor.id,
          kitchenEnabled: !kitchenActor.kitchenEnabled
        })
      });
      setMessage(`Kitchen ${kitchenActor.id} ${kitchenActor.kitchenEnabled ? "disabled" : "enabled"}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle kitchen");
    }
  };

  const createCategory = async () => {
    try {
      await apiFetch("/api/admin/categories", {
        method: "POST",
        body: JSON.stringify({ name: newCategoryName, displayOrder: categories.length + 1 })
      });
      setNewCategoryName("");
      setMessage("Category created");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create category");
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
      setMessage("Menu created");
      setNewMenuName("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create menu");
    }
  };

  const updateMenu = async (menu: Menu, patch: Partial<Menu>) => {
    try {
      await apiFetch("/api/admin/menus", {
        method: "PATCH",
        body: JSON.stringify({ id: menu.id, ...patch })
      });
      setMessage(`Menu updated: ${menu.name}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update menu");
    }
  };

  const toggleAssignment = async (menuId: string, kitchenId: string, enabled: boolean) => {
    try {
      await apiFetch("/api/admin/assignments", {
        method: "POST",
        body: JSON.stringify({ menuId, kitchenId, enabled })
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update assignment");
    }
  };

  const purge = async (target: "ORDERS" | "AUDIT_LOGS") => {
    const confirmed = window.confirm(`Permanently delete ${target}?`);
    if (!confirmed) return;

    try {
      await apiFetch("/api/admin/purge", {
        method: "POST",
        body: JSON.stringify({ target, confirmationText: "DELETE" })
      });
      setMessage(`${target} purged`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to purge records");
    }
  };

  const assignmentMap = new Map(assignments.map((a) => [`${a.menuId}:${a.kitchenId}`, a.enabled]));

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
      <main className="grid">
        <div className="row between wrap">
          <h1 style={{ margin: 0 }}>Admin</h1>
          <div className="row wrap">
            <Link href="/order-book"><button className="ghost-btn">Order Book</button></Link>
            <Link href="/audit"><button className="ghost-btn">Audit Log</button></Link>
          </div>
        </div>

        {message && <div className="notice ok">{message}</div>}
        {error && <div className="notice error">{error}</div>}

        <Card>
          <SectionTitle>Actor Management</SectionTitle>
          <p className="muted" style={{ marginTop: 0 }}>KITCHEN actor ID itself is the kitchen unit ID. No separate kitchenId exists.</p>
          <form onSubmit={createActor} className="grid">
            <input placeholder="actor id" value={newActorId} onChange={(e) => setNewActorId(e.target.value)} required />
            <select value={newActorType} onChange={(e) => setNewActorType(e.target.value as Actor["actorType"])}>
              <option value="POS">POS</option>
              <option value="KITCHEN">KITCHEN</option>
              <option value="WAITER">WAITER</option>
              <option value="MENU_DISPLAY">MENU_DISPLAY</option>
            </select>
            {newActorType === "KITCHEN" && (
              <input
                placeholder="kitchen display order"
                value={newKitchenDisplayOrder}
                onChange={(e) => setNewKitchenDisplayOrder(e.target.value)}
              />
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
                    {actor.actorType === "KITCHEN" ? ` / enabled=${actor.kitchenEnabled ? "yes" : "no"} / order=${actor.kitchenDisplayOrder}` : ""}
                  </div>
                  <div className="muted">{actor.online ? "online" : "offline"}</div>
                </div>
                <div className="row wrap">
                  {actor.actorType === "KITCHEN" && (
                    <button className="ghost-btn" onClick={() => toggleKitchenEnabled(actor)} disabled={!actor.isActive}>
                      {actor.kitchenEnabled ? "Disable Kitchen" : "Enable Kitchen"}
                    </button>
                  )}
                  <button className="ghost-btn" onClick={() => forceLogout(actor.id)} disabled={!actor.isActive}>Force Logout</button>
                  {actor.id !== "admin" && (
                    <button className="ghost-btn" onClick={() => deactivateActor(actor.id)} disabled={!actor.isActive}>Deactivate</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>Menu / Category / Assignment</SectionTitle>
          <div className="grid two">
            <div>
              <div className="row wrap">
                <input placeholder="new category" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} style={{ maxWidth: 220 }} />
                <button className="ghost-btn" onClick={createCategory} disabled={!newCategoryName}>Add Category</button>
              </div>

              <div className="row wrap" style={{ marginTop: 8 }}>
                <input placeholder="new menu name" value={newMenuName} onChange={(e) => setNewMenuName(e.target.value)} style={{ maxWidth: 220 }} />
                <input placeholder="price" value={newMenuPrice} onChange={(e) => setNewMenuPrice(e.target.value)} style={{ maxWidth: 120 }} />
                <select value={newMenuCategoryId} onChange={(e) => setNewMenuCategoryId(e.target.value)} style={{ maxWidth: 220 }}>
                  <option value="">category</option>
                  {categories.filter((c) => c.isActive).map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
                <button className="ghost-btn" onClick={createMenu} disabled={!newMenuName || !newMenuCategoryId}>Add Menu</button>
              </div>
            </div>
          </div>

          <div className="list" style={{ marginTop: 12 }}>
            {menus.map((menu) => (
              <div key={menu.id} className="list-item">
                <div className="row between wrap">
                  <div>
                    <strong>{menu.name}</strong>
                    <div className="muted">{fmtJpy(menu.priceJpy)} / {menu.workloadSeconds}s / {menu.availability}</div>
                  </div>
                  <div className="row wrap">
                    <button className="ghost-btn" onClick={() => updateMenu(menu, { availability: "AVAILABLE" })}>AVAILABLE</button>
                    <button className="ghost-btn" onClick={() => updateMenu(menu, { availability: "PAUSED" })}>PAUSED</button>
                    <button className="ghost-btn" onClick={() => updateMenu(menu, { availability: "SOLD_OUT" })}>SOLD_OUT</button>
                    <button className="ghost-btn" onClick={() => updateMenu(menu, { isActive: !menu.isActive })}>
                      {menu.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </div>

                <div className="row wrap" style={{ marginTop: 8 }}>
                  {kitchenActors.map((kitchen) => {
                    const key = `${menu.id}:${kitchen.id}`;
                    const enabled = assignmentMap.get(key) ?? false;
                    return (
                      <button
                        key={key}
                        className="ghost-btn"
                        onClick={() => toggleAssignment(menu.id, kitchen.id, !enabled)}
                        style={{ borderColor: enabled ? "#111" : "#c0c0c0" }}
                      >
                        {kitchen.label}: {enabled ? "ON" : "OFF"}
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
            <button className="ghost-btn" onClick={() => purge("ORDERS")}>Purge Orders</button>
            <button className="ghost-btn" onClick={() => purge("AUDIT_LOGS")}>Purge Audit Logs</button>
          </div>
        </Card>
      </main>
    </>
  );
}
