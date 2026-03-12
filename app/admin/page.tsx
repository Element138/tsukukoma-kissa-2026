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
  hasActiveKitchenCoverage: boolean;
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

const AVAILABILITY_OPTIONS: Array<Menu["availability"]> = ["AVAILABLE", "PAUSED", "SOLD_OUT"];

function confirmDanger(message: string) {
  return window.confirm(message);
}

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
  const [menuAvailabilityBusyId, setMenuAvailabilityBusyId] = useState<string | null>(null);

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

  const categoryOrderMap = useMemo(() => new Map(activeCategories.map((cat) => [cat.id, cat.displayOrder])), [activeCategories]);

  const activeMenus = useMemo(
    () =>
      menus
        .filter((menu) => menu.isActive)
        .sort((a, b) => {
          const categoryDiff = (categoryOrderMap.get(a.categoryId) ?? 9999) - (categoryOrderMap.get(b.categoryId) ?? 9999);
          if (categoryDiff !== 0) {
            return categoryDiff;
          }
          if (a.displayOrder !== b.displayOrder) {
            return a.displayOrder - b.displayOrder;
          }
          return a.name.localeCompare(b.name, "ja");
        }),
    [menus, categoryOrderMap]
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
      notify({ level: "error", message: e instanceof Error ? e.message : "管理データの更新に失敗しました" });
    } finally {
      reloadInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!session) {
      return;
    }
    void reload();
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

  const deleteActor = async (actor: Actor) => {
    if (!confirmDanger(`アカウント「${actor.label}」を削除します。よろしいですか？`)) {
      return;
    }

    try {
      await apiFetch(`/api/admin/actors?id=${encodeURIComponent(actor.id)}`, { method: "DELETE" });
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
      notify({ level: "success", message: "強制ログアウトしました" });
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
      notify({ level: "success", message: nextEnabled ? "キッチンを稼働にしました" : "キッチンを停止にしました" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "キッチン状態の更新に失敗しました" });
    }
  };

  const createCategory = async () => {
    try {
      await apiFetch("/api/admin/categories", {
        method: "POST",
        body: JSON.stringify({
          name: newCategoryName,
          displayOrder: (activeCategories.at(-1)?.displayOrder ?? 0) + 1
        })
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

  const deleteCategory = async (category: Category) => {
    if (!confirmDanger(`カテゴリ「${category.name}」を削除します。配下メニューも無効化されます。よろしいですか？`)) {
      return;
    }

    try {
      await apiFetch(`/api/admin/categories?id=${encodeURIComponent(category.id)}`, { method: "DELETE" });
      notify({ level: "success", message: "カテゴリを削除しました" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "カテゴリ削除に失敗しました" });
    }
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
      notify({ level: "error", message: e instanceof Error ? e.message : "カテゴリ順更新に失敗しました" });
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
          displayOrder: (activeMenus.at(-1)?.displayOrder ?? 0) + 1,
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
      notify({ level: "error", message: e instanceof Error ? e.message : "メニュー順更新に失敗しました" });
    }
  };

  const deleteMenu = async (menu: Menu) => {
    if (!confirmDanger(`メニュー「${menu.name}」を削除します。よろしいですか？`)) {
      return;
    }

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

  const changeMenuAvailability = async (menu: Menu, status: Menu["availability"]) => {
    if (status === "AVAILABLE" && !menu.hasActiveKitchenCoverage) {
      notify({ level: "error", message: "現在対応できるキッチンがないため、販売中にできません" });
      return;
    }

    setMenuAvailabilityBusyId(menu.id);

    try {
      await patchMenu(menu, { availability: status }, "販売状態を更新しました");
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "販売状態更新に失敗しました" });
    } finally {
      setMenuAvailabilityBusyId(null);
    }
  };

  const toggleAssignment = async (menuId: string, kitchenId: string, enabled: boolean) => {
    try {
      await apiFetch("/api/admin/assignments", {
        method: "POST",
        body: JSON.stringify({ menuId, kitchenId, enabled })
      });
      notify({ level: "success", message: enabled ? "担当を有効化しました" : "担当を無効化しました" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "担当更新に失敗しました" });
    }
  };

  const purge = async (target: "ORDERS" | "AUDIT_LOGS") => {
    const label = target === "ORDERS" ? "注文データ" : "監査ログ";
    const confirmed = confirmDanger(`${label}を削除します。復元できません。実行しますか？`);
    if (!confirmed) {
      return;
    }

    try {
      await apiFetch("/api/admin/purge", {
        method: "POST",
        body: JSON.stringify({ target, confirmationText: "DELETE" })
      });
      notify({ level: "warning", message: `${label}を削除しました` });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "削除に失敗しました" });
    }
  };

  const assignmentMap = new Map(assignments.map((a) => [`${a.menuId}:${a.kitchenId}`, a.enabled]));

  if (loading || !session) {
    return <main>読み込み中...</main>;
  }

  return (
    <>
      <TerminalBanner actorId={session.actor.actorId} actorType={session.actor.actorType} actorLabel={session.actor.label} offlineActors={session.offlineActors} />
      <main className="grid">
        <div className="row between wrap">
          <h1 style={{ margin: 0 }}>管理画面</h1>
          <div className="row wrap">
            <Link href="/order-book" className="btn-link ghost-btn">
              オーダーブック
            </Link>
            <Link href="/audit" className="btn-link ghost-btn">
              監査ログ
            </Link>
          </div>
        </div>

        <Card>
          <SectionTitle>アカウント管理</SectionTitle>
          <form onSubmit={createActor} className="grid">
            <select value={newActorType} onChange={(e) => setNewActorType(e.target.value as Actor["actorType"])}>
              <option value="POS">POS</option>
              <option value="KITCHEN">キッチン</option>
              <option value="WAITER">配膳</option>
            </select>
            {newActorType === "KITCHEN" && (
              <input placeholder="表示順" value={newKitchenDisplayOrder} onChange={(e) => setNewKitchenDisplayOrder(e.target.value)} />
            )}
            <input placeholder="表示名" value={newActorLabel} onChange={(e) => setNewActorLabel(e.target.value)} required />
            <input placeholder="パスワード" value={newActorSecret} onChange={(e) => setNewActorSecret(e.target.value)} required />
            <button type="submit">アカウント作成</button>
          </form>

          <div className="list" style={{ marginTop: 12 }}>
            {actors.map((actor) => (
              <div key={actor.id} className="list-item row between wrap">
                <div>
                  <strong>{actor.label}</strong>
                  <div className="muted">
                    {labelOf(ACTOR_TYPE_LABEL, actor.actorType)}
                    {actor.actorType === "KITCHEN" ? ` / ${actor.kitchenEnabled ? "稼働" : "停止"} / 表示順 ${actor.kitchenDisplayOrder}` : ""}
                  </div>
                  <div className="muted">{actor.online ? "オンライン" : "オフライン"}</div>
                </div>
                <div className="row wrap">
                  <button
                    type="button"
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
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      const next = prompt("新しいパスワード", "");
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
                      <button type="button" className="ghost-btn" onClick={() => toggleKitchenEnabled(actor)} disabled={!actor.isActive}>
                        {actor.kitchenEnabled ? "キッチン停止" : "キッチン稼働"}
                      </button>
                      <button
                        type="button"
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
                  <button type="button" className="ghost-btn" onClick={() => forceLogout(actor.id)} disabled={!actor.isActive}>
                    強制ログアウト
                  </button>
                  {actor.id !== "admin" && actor.actorType !== "MENU_DISPLAY" && (
                    <button type="button" className="ghost-btn danger-btn" onClick={() => deleteActor(actor)} disabled={!actor.isActive}>
                      削除
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
            <input placeholder="新しいカテゴリ名" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} style={{ maxWidth: 220 }} />
            <button type="button" className="ghost-btn" onClick={createCategory} disabled={!newCategoryName}>
              追加
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
                    type="button"
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
                    保存
                  </button>
                </div>
                <div className="row wrap">
                  <button type="button" className="ghost-btn" onClick={() => moveCategory(category.id, -1)} disabled={index === 0}>
                    ↑
                  </button>
                  <button type="button" className="ghost-btn" onClick={() => moveCategory(category.id, 1)} disabled={index === activeCategories.length - 1}>
                    ↓
                  </button>
                  <button type="button" className="ghost-btn danger-btn" onClick={() => deleteCategory(category)}>
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>メニュー管理</SectionTitle>
          <div className="row wrap">
            <input placeholder="新しいメニュー名" value={newMenuName} onChange={(e) => setNewMenuName(e.target.value)} style={{ maxWidth: 220 }} />
            <input placeholder="価格" value={newMenuPrice} onChange={(e) => setNewMenuPrice(e.target.value)} style={{ maxWidth: 120 }} />
            <input placeholder="調理秒数" value={newMenuWorkloadSeconds} onChange={(e) => setNewMenuWorkloadSeconds(e.target.value)} style={{ maxWidth: 120 }} />
            <select value={newMenuCategoryId} onChange={(e) => setNewMenuCategoryId(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">カテゴリを選択</option>
              {activeCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ghost-btn"
              onClick={createMenu}
              disabled={!newMenuName || !newMenuCategoryId || !newMenuPrice || !newMenuWorkloadSeconds}
            >
              追加
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

              return (
                <div key={menu.id} className="list-item">
                  <div className="row between wrap">
                    <div>
                      <strong>{menu.name}</strong>
                      <div className="muted">
                        {fmtJpy(menu.priceJpy)} / {menu.workloadSeconds}秒
                      </div>
                    </div>
                    <div className="menu-status-grid" style={{ minWidth: 360 }}>
                      {AVAILABILITY_OPTIONS.map((status) => {
                        const noCoverageForAvailable = status === "AVAILABLE" && !menu.hasActiveKitchenCoverage;
                        const pseudoDisabled = noCoverageForAvailable || menuAvailabilityBusyId === menu.id;

                        return (
                          <button
                            key={status}
                            type="button"
                            className={`ghost-btn status-btn ${menu.availability === status ? `status-${status.toLowerCase()} active` : ""}`}
                            aria-disabled={pseudoDisabled ? "true" : undefined}
                            onClick={() => {
                              if (pseudoDisabled) {
                                if (noCoverageForAvailable) {
                                  notify({ level: "error", message: "現在対応できるキッチンがないため、販売中にできません" });
                                }
                                return;
                              }
                              void changeMenuAvailability(menu, status);
                            }}
                          >
                            {labelOf(AVAILABILITY_LABEL, status)}
                          </button>
                        );
                      })}
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
                    <button type="button" className="ghost-btn" onClick={() => saveMenuEdit(menu)}>
                      変更を保存
                    </button>
                    <button type="button" className="ghost-btn" onClick={() => moveMenu(menu, -1)}>
                      ↑
                    </button>
                    <button type="button" className="ghost-btn" onClick={() => moveMenu(menu, 1)}>
                      ↓
                    </button>
                    <button type="button" className="ghost-btn danger-btn" onClick={() => deleteMenu(menu)}>
                      削除
                    </button>
                  </div>

                  <div className="row wrap" style={{ marginTop: 8 }}>
                    {kitchenActors.map((kitchen) => {
                      const key = `${menu.id}:${kitchen.id}`;
                      const enabled = assignmentMap.get(key) ?? false;
                      return (
                        <button
                          type="button"
                          key={key}
                          className="ghost-btn"
                          onClick={() => toggleAssignment(menu.id, kitchen.id, !enabled)}
                          style={{ borderColor: enabled ? "#111" : "#c0c0c0" }}
                        >
                          {kitchen.label}: {enabled ? "有効" : "無効"}
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
          <SectionTitle>データ削除</SectionTitle>
          <div className="row wrap">
            <button type="button" className="ghost-btn danger-btn" onClick={() => purge("ORDERS")}>
              注文データを削除
            </button>
            <button type="button" className="ghost-btn danger-btn" onClick={() => purge("AUDIT_LOGS")}>
              監査ログを削除
            </button>
          </div>
        </Card>
      </main>
    </>
  );
}
