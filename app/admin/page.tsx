"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { Card, SectionTitle } from "@/components/ui";
import { TerminalBanner } from "@/components/terminal-banner";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { ACTOR_TYPE_LABEL, AVAILABILITY_LABEL, labelOf } from "@/lib/labels";
import { useToast } from "@/components/toast";

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

type MenuEdit = {
  name: string;
  priceJpy: string;
  workloadSeconds: string;
  categoryId: string;
};

export default function AdminPage() {
  const { loading, session } = useSession(["ADMIN"]);
  const { notify } = useToast();

  const [actors, setActors] = useState<Actor[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const [newActorType, setNewActorType] = useState<Actor["actorType"]>("POS");
  const [newActorLabel, setNewActorLabel] = useState("");
  const [newActorSecret, setNewActorSecret] = useState("");
  const [newKitchenDisplayOrder, setNewKitchenDisplayOrder] = useState("0");

  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryNameDrafts, setCategoryNameDrafts] = useState<Record<string, string>>({});

  const [newMenuName, setNewMenuName] = useState("");
  const [newMenuPrice, setNewMenuPrice] = useState("500");
  const [newMenuCategoryId, setNewMenuCategoryId] = useState("");
  const [newMenuWorkloadSeconds, setNewMenuWorkloadSeconds] = useState("300");
  const [menuEdits, setMenuEdits] = useState<Record<string, MenuEdit>>({});

  const kitchenActors = useMemo(
    () =>
      actors
        .filter((a) => a.actorType === "KITCHEN" && a.isActive)
        .sort((a, b) => a.kitchenDisplayOrder - b.kitchenDisplayOrder || a.label.localeCompare(b.label, "ja")),
    [actors]
  );

  const activeCategories = useMemo(
    () => categories.filter((c) => c.isActive).sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, "ja")),
    [categories]
  );

  const activeMenus = useMemo(
    () => menus.filter((menu) => menu.isActive).sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, "ja")),
    [menus]
  );

  const reloadInFlightRef = useRef(false);

  const reload = async () => {
    if (reloadInFlightRef.current) {
      return;
    }
    reloadInFlightRef.current = true;

    try {
      const [actorRes, menuRes, categoryRes, assignmentRes] = await Promise.all([
        apiFetch<{ actors: Actor[] }>("/api/admin/actors", { timeoutMs: 5000, retry: 1 }),
        apiFetch<{ menus: Menu[]; categories: Category[] }>("/api/admin/menus", { timeoutMs: 5000, retry: 1 }),
        apiFetch<{ categories: Category[] }>("/api/admin/categories", { timeoutMs: 5000, retry: 1 }),
        apiFetch<{ assignments: Assignment[] }>("/api/admin/assignments", { timeoutMs: 5000, retry: 1 })
      ]);

      setActors(actorRes.actors);
      setMenus(menuRes.menus);
      setCategories(categoryRes.categories);
      setAssignments(assignmentRes.assignments);

      setCategoryNameDrafts((prev) => {
        const next = { ...prev };
        for (const category of categoryRes.categories) {
          next[category.id] = next[category.id] ?? category.name;
        }
        return next;
      });

      setMenuEdits((prev) => {
        const next = { ...prev };
        for (const menu of menuRes.menus) {
          next[menu.id] =
            next[menu.id] ?? {
              name: menu.name,
              priceJpy: String(menu.priceJpy),
              workloadSeconds: String(menu.workloadSeconds),
              categoryId: menu.categoryId
            };
        }
        return next;
      });

      if (!newMenuCategoryId && categoryRes.categories.length > 0) {
        setNewMenuCategoryId(categoryRes.categories[0]!.id);
      }
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "管理データの取得に失敗しました" });
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
    channels: ["actors", "menus", "categories", "assignments"],
    onEvent: () => {
      void reload();
    },
    onResync: () => {
      void reload();
    }
  });

  const createActor = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/admin/actors", {
        method: "POST",
        body: JSON.stringify({
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
      notify({ level: "success", message: "アカウントを作成しました" });
      setNewActorLabel("");
      setNewActorSecret("");
      setNewKitchenDisplayOrder("0");
      await reload();
    } catch (e2) {
      notify({ level: "error", message: e2 instanceof Error ? e2.message : "アカウント作成に失敗しました" });
    }
  };

  const updateActor = async (id: string, patch: Record<string, unknown>, successMessage: string) => {
    try {
      await apiFetch("/api/admin/actors", {
        method: "PATCH",
        body: JSON.stringify({ id, ...patch })
      });
      notify({ level: "success", message: successMessage });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "アカウント更新に失敗しました" });
    }
  };

  const deleteActor = async (id: string) => {
    try {
      await apiFetch(`/api/admin/actors?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      notify({ level: "success", message: "アカウントを削除しました" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "アカウント削除に失敗しました" });
    }
  };

  const forceLogout = async (id: string) => {
    try {
      await apiFetch("/api/admin/sessions/force-logout", {
        method: "POST",
        body: JSON.stringify({ actorId: id })
      });
      notify({ level: "success", message: "強制ログアウトを実行しました" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "強制ログアウトに失敗しました" });
    }
  };

  const toggleKitchenEnabled = async (kitchenActor: Actor) => {
    const nextEnabled = !kitchenActor.kitchenEnabled;
    try {
      await apiFetch("/api/kitchen/toggle", {
        method: "POST",
        body: JSON.stringify({
          kitchenId: kitchenActor.id,
          kitchenEnabled: nextEnabled
        })
      });
      notify({ level: "success", message: nextEnabled ? "キッチンを有効化しました" : "キッチンを停止しました" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "キッチン状態の変更に失敗しました" });
    }
  };

  const createCategory = async () => {
    try {
      await apiFetch("/api/admin/categories", {
        method: "POST",
        body: JSON.stringify({ name: newCategoryName, displayOrder: activeCategories.length + 1 })
      });
      setNewCategoryName("");
      notify({ level: "success", message: "カテゴリを作成しました" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "カテゴリ作成に失敗しました" });
    }
  };

  const patchCategory = async (id: string, patch: Partial<Category>, successMessage: string) => {
    await apiFetch("/api/admin/categories", {
      method: "PATCH",
      body: JSON.stringify({ id, ...patch })
    });
    notify({ level: "success", message: successMessage });
  };

  const moveCategory = async (categoryId: string, direction: -1 | 1) => {
    const sorted = [...activeCategories];
    const index = sorted.findIndex((cat) => cat.id === categoryId);
    const target = sorted[index + direction];
    if (index < 0 || !target) {
      return;
    }

    try {
      await Promise.all([
        patchCategory(sorted[index]!.id, { displayOrder: target.displayOrder }, "カテゴリ順を更新しました"),
        patchCategory(target.id, { displayOrder: sorted[index]!.displayOrder }, "カテゴリ順を更新しました")
      ]);
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "カテゴリ順の更新に失敗しました" });
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
          workloadSeconds: Number(newMenuWorkloadSeconds),
          displayOrder: activeMenus.length + 1,
          categoryId: newMenuCategoryId,
          showLeadTime: true
        })
      });
      notify({ level: "success", message: "メニューを作成しました" });
      setNewMenuName("");
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "メニュー作成に失敗しました" });
    }
  };

  const patchMenu = async (menu: Menu, patch: Partial<Menu>, successMessage: string) => {
    await apiFetch("/api/admin/menus", {
      method: "PATCH",
      body: JSON.stringify({ id: menu.id, ...patch })
    });
    notify({ level: "success", message: successMessage });
  };

  const moveMenu = async (menu: Menu, direction: -1 | 1) => {
    const siblings = activeMenus.filter((row) => row.categoryId === menu.categoryId);
    const index = siblings.findIndex((row) => row.id === menu.id);
    const target = siblings[index + direction];
    if (index < 0 || !target) {
      return;
    }

    try {
      await Promise.all([
        patchMenu(menu, { displayOrder: target.displayOrder }, "メニュー順を更新しました"),
        patchMenu(target, { displayOrder: menu.displayOrder }, "メニュー順を更新しました")
      ]);
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "メニュー順の更新に失敗しました" });
    }
  };

  const deleteMenu = async (menu: Menu) => {
    try {
      await patchMenu(menu, { isActive: false }, "メニューを削除しました");
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "メニュー削除に失敗しました" });
    }
  };

  const saveMenuEdit = async (menu: Menu) => {
    const edit = menuEdits[menu.id];
    if (!edit) {
      return;
    }

    try {
      await patchMenu(
        menu,
        {
          name: edit.name,
          priceJpy: Number(edit.priceJpy),
          workloadSeconds: Number(edit.workloadSeconds),
          categoryId: edit.categoryId
        },
        "メニューを更新しました"
      );
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "メニュー更新に失敗しました" });
    }
  };

  const toggleAssignment = async (menuId: string, kitchenId: string, enabled: boolean) => {
    try {
      await apiFetch("/api/admin/assignments", {
        method: "POST",
        body: JSON.stringify({ menuId, kitchenId, enabled })
      });
      notify({ level: "success", message: enabled ? "全員を有効化しました" : "全員を無効化しました" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "全員更新に失敗しました" });
    }
  };

  const purge = async (target: "ORDERS" | "AUDIT_LOGS") => {
    const confirmed = window.confirm(`${target === "ORDERS" ? "注文" : "監査ログ"}を全削除します。実行しますか？`);
    if (!confirmed) {
      return;
    }

    try {
      await apiFetch("/api/admin/purge", {
        method: "POST",
        body: JSON.stringify({ target, confirmationText: "DELETE" })
      });
      notify({ level: "warning", message: `${target === "ORDERS" ? "注文" : "監査ログ"}を削除しました` });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "削除処理に失敗しました" });
    }
  };

  const assignmentMap = new Map(assignments.map((a) => [`${a.menuId}:${a.kitchenId}`, a.enabled]));

  if (loading || !session) {
    return <main>読み込み中...</main>;
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
          <h1 style={{ margin: 0 }}>管理画面</h1>
          <div className="row wrap">
            <Link href="/order-book">
              <button className="ghost-btn">オーダーブック</button>
            </Link>
            <Link href="/audit">
              <button className="ghost-btn">監査ログ</button>
            </Link>
          </div>
        </div>

        <Card>
          <SectionTitle>アカウント管理</SectionTitle>
          <form onSubmit={createActor} className="grid">
            <select value={newActorType} onChange={(e) => setNewActorType(e.target.value as Actor["actorType"])}>
              <option value="POS">POS</option>
              <option value="KITCHEN">キッチン</option>
              <option value="WAITER">\u914d\u81b3</option>
            </select>
            {newActorType === "KITCHEN" && (
              <input
                placeholder="表示順"
                value={newKitchenDisplayOrder}
                onChange={(e) => setNewKitchenDisplayOrder(e.target.value)}
              />
            )}
            <input placeholder="表示名" value={newActorLabel} onChange={(e) => setNewActorLabel(e.target.value)} required />
            <input placeholder="パスワード" value={newActorSecret} onChange={(e) => setNewActorSecret(e.target.value)} required />
            <button>アカウント作成</button>
          </form>

          <div className="list" style={{ marginTop: 12 }}>
            {actors.map((actor) => (
              <div key={actor.id} className="list-item row between wrap">
                <div>
                  <strong>{actor.label}</strong>
                  <div className="muted">
                    {labelOf(ACTOR_TYPE_LABEL, actor.actorType)}
                    {actor.actorType === "KITCHEN" ? ` / ${actor.kitchenEnabled ? "\u6709\u52b9" : "\u505c\u6b62"} / \u9806\u5e8f:${actor.kitchenDisplayOrder}` : ""}
                  </div>
                  <div className="muted">{actor.online ? "オンライン" : "オフライン"}</div>
                </div>
                <div className="row wrap">
                  <button
                    className="ghost-btn"
                    onClick={() => {
                      const next = prompt("新しい表示名", actor.label);
                      if (next && next !== actor.label) {
                        void updateActor(actor.id, { label: next }, "表示名を更新しました");
                      }
                    }}
                    disabled={!actor.isActive}
                  >
                    表示名変更
                  </button>
                  <button
                    className="ghost-btn"
                    onClick={() => {
                      const next = prompt("新しいパスワード（4文字以上）", "");
                      if (next) {
                        void updateActor(actor.id, { secret: next }, "パスワードを更新しました");
                      }
                    }}
                    disabled={!actor.isActive}
                  >
                    パスワード変更
                  </button>
                  {actor.actorType === "KITCHEN" && (
                    <>
                      <button className="ghost-btn" onClick={() => toggleKitchenEnabled(actor)} disabled={!actor.isActive}>
                        {actor.kitchenEnabled ? "キッチン停止" : "キッチン有効化"}
                      </button>
                      <button
                        className="ghost-btn"
                        onClick={() => {
                          const next = prompt("キッチン表示順", String(actor.kitchenDisplayOrder));
                          if (next != null && next.trim() !== "") {
                            void updateActor(actor.id, { kitchenDisplayOrder: Number(next) }, "キッチン表示順を更新しました");
                          }
                        }}
                        disabled={!actor.isActive}
                      >
                        表示順変更
                      </button>
                    </>
                  )}
                  <button className="ghost-btn" onClick={() => forceLogout(actor.id)} disabled={!actor.isActive}>
                    強制ログアウト
                  </button>
                  {actor.id !== "admin" && (
                    <button className="ghost-btn" onClick={() => deleteActor(actor.id)} disabled={!actor.isActive}>
                      \u524a\u9664
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>カテゴリ管理</SectionTitle>
          <div className="row wrap">
            <input placeholder="新規カテゴリ名" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} style={{ maxWidth: 220 }} />
            <button className="ghost-btn" onClick={createCategory} disabled={!newCategoryName}>
              \u8ffd\u52a0
            </button>
          </div>

          <div className="list" style={{ marginTop: 12 }}>
            {activeCategories.map((category, index) => (
              <div key={category.id} className="list-item row between wrap">
                <div className="row wrap" style={{ flex: 1 }}>
                  <input
                    value={categoryNameDrafts[category.id] ?? category.name}
                    onChange={(e) =>
                      setCategoryNameDrafts((prev) => ({
                        ...prev,
                        [category.id]: e.target.value
                      }))
                    }
                    style={{ maxWidth: 320 }}
                  />
                  <button
                    className="ghost-btn"
                    onClick={async () => {
                      try {
                        await patchCategory(category.id, { name: categoryNameDrafts[category.id] ?? category.name }, "カテゴリ名を更新しました");
                        await reload();
                      } catch (e) {
                        notify({ level: "error", message: e instanceof Error ? e.message : "カテゴリ更新に失敗しました" });
                      }
                    }}
                  >
                    \u4fdd\u5b58
                  </button>
                </div>
                <div className="row wrap">
                  <button className="ghost-btn" onClick={() => moveCategory(category.id, -1)} disabled={index === 0}>
                    ?
                  </button>
                  <button
                    className="ghost-btn"
                    onClick={() => moveCategory(category.id, 1)}
                    disabled={index === activeCategories.length - 1}
                  >
                    ?
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>メニュー管理</SectionTitle>
          <div className="row wrap">
            <input placeholder="新規メニュー名" value={newMenuName} onChange={(e) => setNewMenuName(e.target.value)} style={{ maxWidth: 220 }} />
            <input placeholder="\u4fa1\u683c" value={newMenuPrice} onChange={(e) => setNewMenuPrice(e.target.value)} style={{ maxWidth: 120 }} />
            <input
              placeholder="作業秒数"
              value={newMenuWorkloadSeconds}
              onChange={(e) => setNewMenuWorkloadSeconds(e.target.value)}
              style={{ maxWidth: 120 }}
            />
            <select value={newMenuCategoryId} onChange={(e) => setNewMenuCategoryId(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">カテゴリを選択</option>
              {activeCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
            <button
              className="ghost-btn"
              onClick={createMenu}
              disabled={!newMenuName || !newMenuCategoryId || !newMenuPrice || !newMenuWorkloadSeconds}
            >
              \u8ffd\u52a0
            </button>
          </div>

          <div className="list" style={{ marginTop: 12 }}>
            {activeMenus.map((menu) => {
              const edit = menuEdits[menu.id] ?? {
                name: menu.name,
                priceJpy: String(menu.priceJpy),
                workloadSeconds: String(menu.workloadSeconds),
                categoryId: menu.categoryId
              };

              const availabilityButtons: Array<Menu["availability"]> = ["AVAILABLE", "PAUSED", "SOLD_OUT"];

              return (
                <div key={menu.id} className="list-item">
                  <div className="row between wrap">
                    <div>
                      <strong>{menu.name}</strong>
                      <div className="muted">{fmtJpy(menu.priceJpy)} / {menu.workloadSeconds}?</div>
                    </div>
                    <div className="row wrap">
                      {availabilityButtons.map((status) => (
                        <button
                          key={status}
                          className={`ghost-btn status-btn ${menu.availability === status ? `status-${status.toLowerCase()} active` : ""}`}
                          onClick={() => patchMenu(menu, { availability: status }, "販売状態を更新しました")}
                        >
                          {labelOf(AVAILABILITY_LABEL, status)}
                        </button>
                      ))}
                      <button className="ghost-btn" onClick={() => deleteMenu(menu)}>
                        \u524a\u9664
                      </button>
                    </div>
                  </div>

                  <div className="grid four" style={{ marginTop: 10 }}>
                    <input
                      value={edit.name}
                      onChange={(e) =>
                        setMenuEdits((prev) => ({
                          ...prev,
                          [menu.id]: {
                            ...edit,
                            name: e.target.value
                          }
                        }))
                      }
                    />
                    <input
                      value={edit.priceJpy}
                      onChange={(e) =>
                        setMenuEdits((prev) => ({
                          ...prev,
                          [menu.id]: {
                            ...edit,
                            priceJpy: e.target.value
                          }
                        }))
                      }
                    />
                    <input
                      value={edit.workloadSeconds}
                      onChange={(e) =>
                        setMenuEdits((prev) => ({
                          ...prev,
                          [menu.id]: {
                            ...edit,
                            workloadSeconds: e.target.value
                          }
                        }))
                      }
                    />
                    <select
                      value={edit.categoryId}
                      onChange={(e) =>
                        setMenuEdits((prev) => ({
                          ...prev,
                          [menu.id]: {
                            ...edit,
                            categoryId: e.target.value
                          }
                        }))
                      }
                    >
                      {activeCategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="row wrap" style={{ marginTop: 8 }}>
                    <button className="ghost-btn" onClick={() => saveMenuEdit(menu)}>
                      変更保存
                    </button>
                    <button className="ghost-btn" onClick={() => moveMenu(menu, -1)}>
                      ?
                    </button>
                    <button className="ghost-btn" onClick={() => moveMenu(menu, 1)}>
                      ?
                    </button>
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
                          {kitchen.label}: {enabled ? "\u6709\u52b9" : "\u7121\u52b9"}
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
          <SectionTitle>大量削除</SectionTitle>
          <div className="row wrap">
            <button className="ghost-btn" onClick={() => purge("ORDERS")}>注文データを全削除</button>
            <button className="ghost-btn" onClick={() => purge("AUDIT_LOGS")}>監査ログを全削除</button>
          </div>
        </Card>
      </main>
    </>
  );
}