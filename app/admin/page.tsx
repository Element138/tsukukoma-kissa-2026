"use client";

import {
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  Add20Regular,
  AppsList20Regular,
  ArrowDown20Regular,
  ArrowUp20Regular,
  Box20Regular,
  Delete20Regular,
  Edit20Regular,
  Key20Regular,
  Save20Regular,
  SignOut20Regular,
  PersonFilled,
  ShoppingBagFilled,
  DocumentBulletListFilled,
} from "@fluentui/react-icons";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { ACTOR_TYPE_LABEL, AVAILABILITY_LABEL, labelOf } from "@/lib/labels";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
type Assignment = { menuId: string; kitchenId: string; enabled: boolean };
type MenuEdit = {
  name: string;
  priceJpy: string;
  workloadSeconds: string;
  categoryId: string;
};

const AVAILABILITY_OPTIONS: Array<Menu["availability"]> = [
  "AVAILABLE",
  "PAUSED",
  "SOLD_OUT",
];
const STATUS_BUTTON_ACTIVE_TONE: Record<Menu["availability"], string> = {
  AVAILABLE:
    "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700",
  PAUSED: "border-amber-700 bg-amber-500 text-white hover:bg-amber-600",
  SOLD_OUT: "border-rose-700 bg-rose-600 text-white hover:bg-rose-700",
};

const dangerConfirm = (message: string) => window.confirm(message);

function SectionHeader(props: {
  title: string;
  subtitle: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-8 w-8 place-items-center rounded-md border bg-muted/30 text-foreground">
        {props.icon}
      </div>
      <div>
        <h2 className="text-sm font-semibold leading-none tracking-tight">
          {props.title}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{props.subtitle}</p>
      </div>
    </div>
  );
}

function InputField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <label className={cn("grid gap-0", props.className)}>
      <span className="text-[11px] font-medium leading-none text-muted-foreground">
        {props.label}
      </span>
      <Input
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

function IconActionButton(props: {
  label: string;
  icon: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8",
            props.destructive &&
              "text-destructive hover:bg-destructive/10 hover:text-destructive",
          )}
          disabled={props.disabled}
          onClick={props.onClick}
        >
          {props.icon}
          <span className="sr-only">{props.label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
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

  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryNameDrafts, setCategoryNameDrafts] = useState<
    Record<string, string>
  >({});

  const [newMenuName, setNewMenuName] = useState("");
  const [newMenuPrice, setNewMenuPrice] = useState("500");
  const [newMenuCategoryId, setNewMenuCategoryId] = useState("");
  const [newMenuWorkloadSeconds, setNewMenuWorkloadSeconds] = useState("300");
  const [menuEdits, setMenuEdits] = useState<Record<string, MenuEdit>>({});
  const [menuAvailabilityBusyId, setMenuAvailabilityBusyId] = useState<
    string | null
  >(null);

  const reloadInFlightRef = useRef(false);

  const kitchenActors = useMemo(
    () =>
      actors
        .filter((a) => a.actorType === "KITCHEN" && a.isActive)
        .sort(
          (a, b) =>
            a.kitchenDisplayOrder - b.kitchenDisplayOrder ||
            a.label.localeCompare(b.label, "ja"),
        ),
    [actors],
  );
  const activeCategories = useMemo(
    () =>
      categories
        .filter((c) => c.isActive)
        .sort(
          (a, b) =>
            a.displayOrder - b.displayOrder ||
            a.name.localeCompare(b.name, "ja"),
        ),
    [categories],
  );
  const categoryOrder = useMemo(
    () => new Map(activeCategories.map((c) => [c.id, c.displayOrder])),
    [activeCategories],
  );
  const activeMenus = useMemo(
    () =>
      menus
        .filter((m) => m.isActive)
        .sort(
          (a, b) =>
            (categoryOrder.get(a.categoryId) ?? 9999) -
              (categoryOrder.get(b.categoryId) ?? 9999) ||
            a.displayOrder - b.displayOrder ||
            a.name.localeCompare(b.name, "ja"),
        ),
    [menus, categoryOrder],
  );

  const reload = async () => {
    if (reloadInFlightRef.current) return;
    reloadInFlightRef.current = true;
    try {
      const [a, m, c, s] = await Promise.all([
        apiFetch<{ actors: Actor[] }>("/api/admin/actors", {
          timeoutMs: 5000,
          retry: 1,
        }),
        apiFetch<{ menus: Menu[]; categories: Category[] }>(
          "/api/admin/menus",
          { timeoutMs: 5000, retry: 1 },
        ),
        apiFetch<{ categories: Category[] }>("/api/admin/categories", {
          timeoutMs: 5000,
          retry: 1,
        }),
        apiFetch<{ assignments: Assignment[] }>("/api/admin/assignments", {
          timeoutMs: 5000,
          retry: 1,
        }),
      ]);
      setActors(a.actors);
      setMenus(m.menus);
      setCategories(c.categories);
      setAssignments(s.assignments);
      setCategoryNameDrafts((prev) =>
        Object.fromEntries(
          c.categories.map((cat) => [cat.id, prev[cat.id] ?? cat.name]),
        ),
      );
      setMenuEdits((prev) => {
        const next = { ...prev };
        for (const menu of m.menus) {
          next[menu.id] = next[menu.id] ?? {
            name: menu.name,
            priceJpy: String(menu.priceJpy),
            workloadSeconds: String(menu.workloadSeconds),
            categoryId: menu.categoryId,
          };
        }
        return next;
      });
      if (!newMenuCategoryId && c.categories.length > 0)
        setNewMenuCategoryId(c.categories[0]!.id);
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "管理データの更新に失敗しました",
      });
    } finally {
      reloadInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!session) return;
    void reload();
  }, [session]);

  useRealtimeSubscription({
    enabled: Boolean(session),
    channels: ["actors", "menus", "categories", "assignments"],
    onEvent: () => void reload(),
    onResync: () => void reload(),
  });

  const updateActor = async (
    id: string,
    patch: Record<string, unknown>,
    successMessage: string,
  ) => {
    try {
      await apiFetch("/api/admin/actors", {
        method: "PATCH",
        body: JSON.stringify({ id, ...patch }),
      });
      notify({ level: "success", message: successMessage });
      await reload();
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "アカウント更新に失敗しました",
      });
    }
  };

  const createActor = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/admin/actors", {
        method: "POST",
        body: JSON.stringify({
          actorType: newActorType,
          label: newActorLabel,
          secret: newActorSecret,
          ...(newActorType === "KITCHEN" ? { kitchenEnabled: true } : {}),
        }),
      });
      notify({ level: "success", message: "アカウントを作成しました" });
      setNewActorLabel("");
      setNewActorSecret("");
      await reload();
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "アカウント作成に失敗しました",
      });
    }
  };

  const patchCategory = async (
    id: string,
    patch: Partial<Category>,
    msg: string,
  ) => {
    await apiFetch("/api/admin/categories", {
      method: "PATCH",
      body: JSON.stringify({ id, ...patch }),
    });
    notify({ level: "success", message: msg });
  };
  const patchMenu = async (menu: Menu, patch: Partial<Menu>, msg: string) => {
    await apiFetch("/api/admin/menus", {
      method: "PATCH",
      body: JSON.stringify({ id: menu.id, ...patch }),
    });
    notify({ level: "success", message: msg });
  };

  const moveMenu = async (menu: Menu, direction: -1 | 1) => {
    const index = activeMenus.findIndex((row) => row.id === menu.id);
    const target = activeMenus[index + direction];
    if (!target) {
      return;
    }

    try {
      await Promise.all([
        patchMenu(
          menu,
          { displayOrder: target.displayOrder },
          "メニュー順を更新しました",
        ),
        patchMenu(
          target,
          { displayOrder: menu.displayOrder },
          "メニュー順を更新しました",
        ),
      ]);
      await reload();
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "メニュー順の更新に失敗しました",
      });
    }
  };

  const assignmentMap = new Map(
    assignments.map((a) => [`${a.menuId}:${a.kitchenId}`, a.enabled]),
  );

  if (loading || !session) return <main>読み込み中...</main>;

  return (
    <>
      <TerminalBanner
        actorId={session.actor.actorId}
        actorType={session.actor.actorType}
        actorLabel={session.actor.label}
        offlineActors={session.offlineActors}
      />
      <DashboardShell
        className="admin-shell"
        eyebrow="ADMIN CONTROL"
        title="管理ダッシュボード"
        // subtitle="アカウント、カテゴリ、メニュー、担当設定をまとめて運用"
        fancyHeader
        actions={
          <div className="flex items-center justify-end gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/order-book">
                <Box20Regular />
                オーダーブック
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/audit">
                <AppsList20Regular />
                監査ログ
              </Link>
            </Button>
          </div>
        }
      >
        <TooltipProvider delayDuration={120}>
          <div className="grid gap-3 xl:grid-cols-[1.08fr_0.92fr]">
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader
                  title="アカウント"
                  subtitle="役割・状態・権限操作"
                  icon={<PersonFilled />}
                />
              </CardHeader>
              <CardContent className="space-y-3">
                <Accordion
                  type="single"
                  collapsible
                  defaultValue="new-actor"
                  className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3"
                >
                  <AccordionItem value="new-actor" className="border-b-0">
                    <AccordionTrigger className="py-2 text-sm font-semibold text-emerald-900 hover:no-underline">
                      新規アカウントを追加
                    </AccordionTrigger>
                    <AccordionContent>
                      <form
                        onSubmit={createActor}
                        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
                      >
                        <label className="grid gap-0">
                          <span className="text-[11px] font-medium leading-none text-muted-foreground">
                            ロール
                          </span>
                          <Select
                            value={newActorType}
                            onValueChange={(v) =>
                              setNewActorType(v as Actor["actorType"])
                            }
                          >
                            <SelectTrigger className="bg-background text-foreground">
                              <SelectValue placeholder="ロール" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="POS">POS</SelectItem>
                              <SelectItem value="KITCHEN">キッチン</SelectItem>
                              <SelectItem value="WAITER">配膳</SelectItem>
                              <SelectItem value="MENU_DISPLAY">
                                メニュー表示
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </label>
                        <InputField
                          label="表示名"
                          value={newActorLabel}
                          onChange={setNewActorLabel}
                        />
                        <InputField
                          label="パスワード"
                          value={newActorSecret}
                          onChange={setNewActorSecret}
                        />
                        <Button
                          type="submit"
                          className="sm:col-span-2 lg:col-span-1 lg:self-end"
                        >
                          <Add20Regular />
                          作成
                        </Button>
                      </form>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                <div className="grid gap-2">
                  {actors.map((actor) => (
                    <article
                      key={actor.id}
                      className="rounded-lg border bg-card/70 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <strong className="text-sm">{actor.label}</strong>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {labelOf(ACTOR_TYPE_LABEL, actor.actorType)}
                            {/* {actor.actorType === "KITCHEN"
                              ? ` / 表示順 ${actor.kitchenDisplayOrder}`
                              : ""} */}
                          </div>
                        </div>
                        <Badge
                          variant={actor.online ? "secondary" : "outline"}
                          className={
                            actor.online
                              ? "bg-emerald-100 text-emerald-800"
                              : ""
                          }
                        >
                          {actor.online ? "ONLINE" : "OFFLINE"}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <IconActionButton
                          label="表示名変更"
                          icon={<Edit20Regular />}
                          disabled={!actor.isActive}
                          onClick={() => {
                            const next = prompt("新しい表示名", actor.label);
                            if (next && next !== actor.label)
                              void updateActor(
                                actor.id,
                                { label: next },
                                "表示名を更新しました",
                              );
                          }}
                        />
                        <IconActionButton
                          label="パスワード変更"
                          icon={<Key20Regular />}
                          disabled={!actor.isActive}
                          onClick={() => {
                            const next = prompt("新しいパスワード", "");
                            if (next)
                              void updateActor(
                                actor.id,
                                { secret: next },
                                "パスワードを更新しました",
                              );
                          }}
                        />
                        <IconActionButton
                          label="強制ログアウト"
                          icon={<SignOut20Regular />}
                          disabled={!actor.isActive}
                          onClick={() =>
                            void apiFetch("/api/admin/sessions/force-logout", {
                              method: "POST",
                              body: JSON.stringify({ actorId: actor.id }),
                            }).then(() => reload())
                          }
                        />
                        {actor.actorType === "KITCHEN" && (
                          <label className="ml-1 inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                            <span className="text-muted-foreground">
                              キッチン稼働
                            </span>
                            <Switch
                              checked={actor.kitchenEnabled}
                              disabled={!actor.isActive}
                              onCheckedChange={(checked) =>
                                void apiFetch("/api/kitchen/toggle", {
                                  method: "POST",
                                  body: JSON.stringify({
                                    kitchenId: actor.id,
                                    kitchenEnabled: checked,
                                  }),
                                }).then(() => reload())
                              }
                            />
                          </label>
                        )}
                        {actor.id !== "admin" &&
                          actor.actorType !== "MENU_DISPLAY" && (
                            <div className="ml-auto">
                              <IconActionButton
                                label="削除"
                                icon={<Delete20Regular />}
                                destructive
                                disabled={!actor.isActive}
                                onClick={() => {
                                  if (
                                    dangerConfirm(
                                      `アカウント「${actor.label}」を削除します。よろしいですか？`,
                                    )
                                  )
                                    void apiFetch(
                                      `/api/admin/actors?id=${encodeURIComponent(actor.id)}`,
                                      { method: "DELETE" },
                                    ).then(() => reload());
                                }}
                              />
                            </div>
                          )}
                      </div>
                    </article>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader
                  title="カテゴリ"
                  subtitle="名前・並び順"
                  icon={<ShoppingBagFilled />}
                />
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-end gap-2">
                  <InputField
                    label="新しいカテゴリ名"
                    value={newCategoryName}
                    onChange={setNewCategoryName}
                    className="max-w-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      await apiFetch("/api/admin/categories", {
                        method: "POST",
                        body: JSON.stringify({
                          name: newCategoryName,
                          displayOrder:
                            (activeCategories.at(-1)?.displayOrder ?? 0) + 1,
                        }),
                      });
                      setNewCategoryName("");
                      await reload();
                    }}
                    disabled={!newCategoryName}
                  >
                    <Add20Regular />
                    追加
                  </Button>
                </div>
                <div className="grid gap-2">
                  {activeCategories.map((cat, index) => (
                    <article
                      key={cat.id}
                      className="rounded-lg border bg-card/70 p-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          value={categoryNameDrafts[cat.id] ?? cat.name}
                          onChange={(e) =>
                            setCategoryNameDrafts((p) => ({
                              ...p,
                              [cat.id]: e.target.value,
                            }))
                          }
                        />
                        <Badge variant="outline">#{cat.displayOrder}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <IconActionButton
                          label="保存"
                          icon={<Save20Regular />}
                          onClick={() =>
                            void patchCategory(
                              cat.id,
                              { name: categoryNameDrafts[cat.id] ?? cat.name },
                              "カテゴリ名を更新しました",
                            ).then(() => reload())
                          }
                        />
                        <IconActionButton
                          label="上へ"
                          icon={<ArrowUp20Regular />}
                          disabled={index === 0}
                          onClick={() =>
                            void (async () => {
                              const sorted = [...activeCategories];
                              const target = sorted[index - 1];
                              if (!target) return;
                              await Promise.all([
                                patchCategory(
                                  cat.id,
                                  { displayOrder: target.displayOrder },
                                  "カテゴリ順を更新しました",
                                ),
                                patchCategory(
                                  target.id,
                                  { displayOrder: cat.displayOrder },
                                  "カテゴリ順を更新しました",
                                ),
                              ]);
                              await reload();
                            })()
                          }
                        />
                        <IconActionButton
                          label="下へ"
                          icon={<ArrowDown20Regular />}
                          disabled={index === activeCategories.length - 1}
                          onClick={() =>
                            void (async () => {
                              const sorted = [...activeCategories];
                              const target = sorted[index + 1];
                              if (!target) return;
                              await Promise.all([
                                patchCategory(
                                  cat.id,
                                  { displayOrder: target.displayOrder },
                                  "カテゴリ順を更新しました",
                                ),
                                patchCategory(
                                  target.id,
                                  { displayOrder: cat.displayOrder },
                                  "カテゴリ順を更新しました",
                                ),
                              ]);
                              await reload();
                            })()
                          }
                        />
                        <div className="ml-auto">
                          <IconActionButton
                            label="削除"
                            icon={<Delete20Regular />}
                            destructive
                            onClick={() => {
                              if (
                                dangerConfirm(
                                  `カテゴリ「${cat.name}」を削除します。よろしいですか？`,
                                )
                              )
                                void apiFetch(
                                  `/api/admin/categories?id=${encodeURIComponent(cat.id)}`,
                                  { method: "DELETE" },
                                ).then(() => reload());
                            }}
                          />
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <SectionHeader
                title="メニュー"
                subtitle="販売状態・編集・担当設定"
                icon={<DocumentBulletListFilled />}
              />
            </CardHeader>
            <CardContent className="space-y-3">
              <Accordion
                type="single"
                collapsible
                defaultValue="new-menu"
                className="rounded-lg border border-emerald-200 bg-emerald-50/70"
              >
                <AccordionItem value="new-menu" className="border-b-0">
                  <AccordionTrigger className="py-2 px-3 text-sm font-semibold text-emerald-900 hover:no-underline">
                    新規メニューを追加
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <InputField
                        label="メニュー名"
                        value={newMenuName}
                        onChange={setNewMenuName}
                      />
                      <InputField
                        label="価格 (円)"
                        value={newMenuPrice}
                        onChange={setNewMenuPrice}
                      />
                      <InputField
                        label="作業時間 (秒)"
                        value={newMenuWorkloadSeconds}
                        onChange={setNewMenuWorkloadSeconds}
                      />
                      <label className="grid gap-0">
                        <span className="text-[11px] font-medium leading-none text-muted-foreground">
                          カテゴリ
                        </span>
                        <Select
                          value={newMenuCategoryId}
                          onValueChange={setNewMenuCategoryId}
                        >
                          <SelectTrigger className="bg-background text-foreground">
                            <SelectValue placeholder="カテゴリ" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeCategories.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <Button
                        type="button"
                        className="self-end"
                        onClick={async () => {
                          await apiFetch("/api/admin/menus", {
                            method: "POST",
                            body: JSON.stringify({
                              name: newMenuName,
                              priceJpy: Number(newMenuPrice),
                              availability: "PAUSED",
                              workloadSeconds: Number(newMenuWorkloadSeconds),
                              displayOrder:
                                (activeMenus.at(-1)?.displayOrder ?? 0) + 1,
                              categoryId: newMenuCategoryId,
                              showLeadTime: true,
                            }),
                          });
                          setNewMenuName("");
                          await reload();
                        }}
                        disabled={
                          !newMenuName ||
                          !newMenuCategoryId ||
                          !newMenuPrice ||
                          !newMenuWorkloadSeconds
                        }
                      >
                        <Add20Regular />
                        追加
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              <Accordion type="single" collapsible className="space-y-2">
                {activeMenus.map((menu, index) => {
                  const edit = menuEdits[menu.id] ?? {
                    name: menu.name,
                    priceJpy: String(menu.priceJpy),
                    workloadSeconds: String(menu.workloadSeconds),
                    categoryId: menu.categoryId,
                  };
                  return (
                    <AccordionItem
                      key={menu.id}
                      value={menu.id}
                      className="rounded-lg border bg-muted/25 px-3"
                    >
                      <AccordionTrigger className="py-3 hover:no-underline">
                        <div className="flex w-full flex-col gap-2 text-left md:flex-row md:items-center md:justify-between">
                          <div>
                            <strong className="text-sm">{menu.name}</strong>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {fmtJpy(menu.priceJpy)} / {menu.workloadSeconds}秒
                            </div>
                          </div>
                          <div
                            className="grid grid-cols-3 gap-1 md:min-w-72"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {AVAILABILITY_OPTIONS.map((status) => {
                              const noCoverage =
                                status === "AVAILABLE" &&
                                !menu.hasActiveKitchenCoverage;
                              const disabled =
                                menuAvailabilityBusyId === menu.id;
                              const active = menu.availability === status;
                              return (
                                <Button
                                  key={status}
                                  type="button"
                                  variant={active ? "default" : "outline"}
                                  disabled={disabled}
                                  className={cn(
                                    "h-8 px-2 text-[11px] font-semibold leading-none",
                                    noCoverage && !active && "opacity-50",
                                    active
                                      ? STATUS_BUTTON_ACTIVE_TONE[status]
                                      : "bg-background text-foreground hover:bg-muted",
                                  )}
                                  onClick={() =>
                                    void (async () => {
                                      if (noCoverage) {
                                        notify({
                                          level: "error",
                                          message:
                                            "現在対応できるキッチンがないため、販売中にできません",
                                        });
                                        return;
                                      }
                                      setMenuAvailabilityBusyId(menu.id);
                                      try {
                                        await patchMenu(
                                          menu,
                                          { availability: status },
                                          "販売状態を更新しました",
                                        );
                                        await reload();
                                      } finally {
                                        setMenuAvailabilityBusyId(null);
                                      }
                                    })()
                                  }
                                >
                                  {labelOf(AVAILABILITY_LABEL, status)}
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <InputField
                            label="メニュー名"
                            value={edit.name}
                            onChange={(v) =>
                              setMenuEdits((p) => ({
                                ...p,
                                [menu.id]: { ...edit, name: v },
                              }))
                            }
                          />
                          <InputField
                            label="価格 (円)"
                            value={edit.priceJpy}
                            onChange={(v) =>
                              setMenuEdits((p) => ({
                                ...p,
                                [menu.id]: { ...edit, priceJpy: v },
                              }))
                            }
                          />
                          <InputField
                            label="作業時間 (秒)"
                            value={edit.workloadSeconds}
                            onChange={(v) =>
                              setMenuEdits((p) => ({
                                ...p,
                                [menu.id]: { ...edit, workloadSeconds: v },
                              }))
                            }
                          />
                          <label className="grid gap-0">
                            <span className="text-[11px] font-medium leading-none text-muted-foreground">
                              カテゴリ
                            </span>
                            <Select
                              value={edit.categoryId}
                              onValueChange={(v) =>
                                setMenuEdits((p) => ({
                                  ...p,
                                  [menu.id]: { ...edit, categoryId: v },
                                }))
                              }
                            >
                              <SelectTrigger className="bg-background text-foreground">
                                <SelectValue placeholder="カテゴリ" />
                              </SelectTrigger>
                              <SelectContent>
                                {activeCategories.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <IconActionButton
                            label="保存"
                            icon={<Save20Regular />}
                            onClick={() =>
                              void patchMenu(
                                menu,
                                {
                                  name: edit.name,
                                  priceJpy: Number(edit.priceJpy),
                                  workloadSeconds: Number(edit.workloadSeconds),
                                  categoryId: edit.categoryId,
                                },
                                "メニューを更新しました",
                              ).then(() => reload())
                            }
                          />
                          <IconActionButton
                            label="上へ"
                            icon={<ArrowUp20Regular />}
                            disabled={index === 0}
                            onClick={() => void moveMenu(menu, -1)}
                          />
                          <IconActionButton
                            label="下へ"
                            icon={<ArrowDown20Regular />}
                            disabled={index === activeMenus.length - 1}
                            onClick={() => void moveMenu(menu, 1)}
                          />
                          <div className="ml-auto">
                            <IconActionButton
                              label="削除"
                              icon={<Delete20Regular />}
                              destructive
                              onClick={() => {
                                if (
                                  dangerConfirm(
                                    `メニュー「${menu.name}」を削除します。よろしいですか？`,
                                  )
                                )
                                  void patchMenu(
                                    menu,
                                    { isActive: false },
                                    "メニューを削除しました",
                                  ).then(() => reload());
                              }}
                            />
                          </div>
                        </div>
                        <div className="grid gap-2 rounded-md border bg-card/60 p-3">
                          <div className="text-xs font-semibold text-muted-foreground">
                            キッチン割り当て
                          </div>
                          {kitchenActors.map((kitchen) => {
                            const key = `${menu.id}:${kitchen.id}`;
                            const enabled = assignmentMap.get(key) ?? false;
                            return (
                              <label
                                key={key}
                                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                              >
                                <span className="font-medium">
                                  {kitchen.label}
                                </span>
                                <Switch
                                  checked={enabled}
                                  onCheckedChange={(checked) =>
                                    void apiFetch("/api/admin/assignments", {
                                      method: "POST",
                                      body: JSON.stringify({
                                        menuId: menu.id,
                                        kitchenId: kitchen.id,
                                        enabled: checked,
                                      }),
                                    }).then(() => reload())
                                  }
                                />
                              </label>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">データ削除</CardTitle>
              <CardDescription>復元不可の操作</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  if (
                    dangerConfirm(
                      "注文データを削除します。復元できません。実行しますか？",
                    )
                  )
                    void apiFetch("/api/admin/purge", {
                      method: "POST",
                      body: JSON.stringify({
                        target: "ORDERS",
                        confirmationText: "DELETE",
                      }),
                    }).then(() => reload());
                }}
              >
                <Delete20Regular />
                注文データを削除
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  if (
                    dangerConfirm(
                      "監査ログを削除します。復元できません。実行しますか？",
                    )
                  )
                    void apiFetch("/api/admin/purge", {
                      method: "POST",
                      body: JSON.stringify({
                        target: "AUDIT_LOGS",
                        confirmationText: "DELETE",
                      }),
                    }).then(() => reload());
                }}
              >
                <Delete20Regular />
                監査ログを削除
              </Button>
            </CardContent>
          </Card>
        </TooltipProvider>
      </DashboardShell>
    </>
  );
}
