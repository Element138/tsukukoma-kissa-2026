"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
  Power20Regular,
  Save20Regular,
  SignOut20Regular
} from "@fluentui/react-icons";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { ACTOR_TYPE_LABEL, AVAILABILITY_LABEL, labelOf } from "@/lib/labels";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
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
const AVAILABILITY_TONE: Record<Menu["availability"], string> = {
  AVAILABLE: "bg-emerald-600 text-white hover:bg-emerald-700",
  PAUSED: "bg-amber-600 text-white hover:bg-amber-700",
  SOLD_OUT: "bg-rose-600 text-white hover:bg-rose-700"
};

function confirmDanger(message: string) {
  return window.confirm(message);
}

function SectionHeader(props: { title: string; subtitle: string; icon: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-8 w-8 place-items-center rounded-md border bg-muted/30 text-foreground">{props.icon}</div>
      <div>
        <h2 className="text-sm font-semibold leading-none tracking-tight">{props.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{props.subtitle}</p>
      </div>
    </div>
  );
}

function IconActionButton(props: { label: string; icon: ReactNode; className?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", props.className)}
          onClick={props.onClick}
          disabled={props.disabled}
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
          if (categoryDiff !== 0) return categoryDiff;
          if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
          return a.name.localeCompare(b.name, "ja");
        }),
    [menus, categoryOrderMap]
  );

  const reloadInFlightRef = useRef(false);

  const reload = async () => {
    if (reloadInFlightRef.current) return;
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
      notify({ level: "error", message: e instanceof Error ? e.message : "�Ǘ��f�[�^�̍X�V�Ɏ��s���܂���" });
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
    onResync: () => void reload()
  });

  const updateActor = async (id: string, patch: Record<string, unknown>, successMessage: string) => {
    try {
      await apiFetch("/api/admin/actors", { method: "PATCH", body: JSON.stringify({ id, ...patch }) });
      notify({ level: "success", message: successMessage });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "�A�J�E���g�X�V�Ɏ��s���܂���" });
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
          ...(newActorType === "KITCHEN" ? { kitchenEnabled: true, kitchenDisplayOrder: Number(newKitchenDisplayOrder) } : {})
        })
      });
      notify({ level: "success", message: "�A�J�E���g��쐬���܂���" });
      setNewActorLabel("");
      setNewActorSecret("");
      setNewKitchenDisplayOrder("0");
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "�A�J�E���g�쐬�Ɏ��s���܂���" });
    }
  };

  const deleteActor = async (actor: Actor) => {
    if (!confirmDanger(`�A�J�E���g�u${actor.label}�v��폜���܂��B��낵���ł����H`)) return;
    try {
      await apiFetch(`/api/admin/actors?id=${encodeURIComponent(actor.id)}`, { method: "DELETE" });
      notify({ level: "success", message: "�A�J�E���g��폜���܂���" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "�A�J�E���g�폜�Ɏ��s���܂���" });
    }
  };

  const forceLogout = async (id: string) => {
    try {
      await apiFetch("/api/admin/sessions/force-logout", { method: "POST", body: JSON.stringify({ actorId: id }) });
      notify({ level: "success", message: "�������O�A�E�g���܂���" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "�������O�A�E�g�Ɏ��s���܂���" });
    }
  };

  const toggleKitchenEnabled = async (actor: Actor) => {
    try {
      await apiFetch("/api/kitchen/toggle", { method: "POST", body: JSON.stringify({ kitchenId: actor.id, kitchenEnabled: !actor.kitchenEnabled }) });
      notify({ level: "success", message: !actor.kitchenEnabled ? "�L�b�`����ғ��ɂ��܂���" : "�L�b�`�����~�ɂ��܂���" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "�L�b�`����Ԃ̍X�V�Ɏ��s���܂���" });
    }
  };

  const patchCategory = async (id: string, patch: Partial<Category>, successMessage: string) => {
    await apiFetch("/api/admin/categories", { method: "PATCH", body: JSON.stringify({ id, ...patch }) });
    notify({ level: "success", message: successMessage });
  };

  const createCategory = async () => {
    try {
      await apiFetch("/api/admin/categories", {
        method: "POST",
        body: JSON.stringify({ name: newCategoryName, displayOrder: (activeCategories.at(-1)?.displayOrder ?? 0) + 1 })
      });
      setNewCategoryName("");
      notify({ level: "success", message: "�J�e�S����쐬���܂���" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "�J�e�S���쐬�Ɏ��s���܂���" });
    }
  };

  const moveCategory = async (categoryId: string, direction: -1 | 1) => {
    const sorted = [...activeCategories];
    const index = sorted.findIndex((cat) => cat.id === categoryId);
    const target = sorted[index + direction];
    if (index < 0 || !target) return;
    try {
      await Promise.all([
        patchCategory(sorted[index]!.id, { displayOrder: target.displayOrder }, "�J�e�S������X�V���܂���"),
        patchCategory(target.id, { displayOrder: sorted[index]!.displayOrder }, "�J�e�S������X�V���܂���")
      ]);
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "�J�e�S�����X�V�Ɏ��s���܂���" });
    }
  };

  const deleteCategory = async (category: Category) => {
    if (!confirmDanger(`�J�e�S���u${category.name}�v��폜���܂��B�z�����j���[�����������܂��B��낵���ł����H`)) return;
    try {
      await apiFetch(`/api/admin/categories?id=${encodeURIComponent(category.id)}`, { method: "DELETE" });
      notify({ level: "success", message: "�J�e�S����폜���܂���" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "�J�e�S���폜�Ɏ��s���܂���" });
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
      notify({ level: "success", message: "���j���[��쐬���܂���" });
      setNewMenuName("");
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "���j���[�쐬�Ɏ��s���܂���" });
    }
  };

  const patchMenu = async (menu: Menu, patch: Partial<Menu>, successMessage: string) => {
    await apiFetch("/api/admin/menus", { method: "PATCH", body: JSON.stringify({ id: menu.id, ...patch }) });
    notify({ level: "success", message: successMessage });
  };

  const changeMenuAvailability = async (menu: Menu, status: Menu["availability"]) => {
    if (status === "AVAILABLE" && !menu.hasActiveKitchenCoverage) {
      notify({ level: "error", message: "���ݑΉ��ł���L�b�`�����Ȃ����߁A�̔����ɂł��܂���" });
      return;
    }

    setMenuAvailabilityBusyId(menu.id);
    try {
      await patchMenu(menu, { availability: status }, "�̔���Ԃ�X�V���܂���");
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "�̔���ԍX�V�Ɏ��s���܂���" });
    } finally {
      setMenuAvailabilityBusyId(null);
    }
  };

  const saveMenuEdit = async (menu: Menu) => {
    const edit = menuEdits[menu.id];
    if (!edit) return;
    try {
      await patchMenu(menu, { name: edit.name, priceJpy: Number(edit.priceJpy), workloadSeconds: Number(edit.workloadSeconds), categoryId: edit.categoryId }, "���j���[��X�V���܂���");
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "���j���[�X�V�Ɏ��s���܂���" });
    }
  };

  const moveMenu = async (menu: Menu, direction: -1 | 1) => {
    const siblings = activeMenus.filter((row) => row.categoryId === menu.categoryId);
    const index = siblings.findIndex((row) => row.id === menu.id);
    const target = siblings[index + direction];
    if (index < 0 || !target) return;
    try {
      await Promise.all([
        patchMenu(menu, { displayOrder: target.displayOrder }, "���j���[����X�V���܂���"),
        patchMenu(target, { displayOrder: menu.displayOrder }, "���j���[����X�V���܂���")
      ]);
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "���j���[���X�V�Ɏ��s���܂���" });
    }
  };

  const deleteMenu = async (menu: Menu) => {
    if (!confirmDanger(`���j���[�u${menu.name}�v��폜���܂��B��낵���ł����H`)) return;
    try {
      await patchMenu(menu, { isActive: false }, "���j���[��폜���܂���");
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "���j���[�폜�Ɏ��s���܂���" });
    }
  };

  const toggleAssignment = async (menuId: string, kitchenId: string, enabled: boolean) => {
    try {
      await apiFetch("/api/admin/assignments", { method: "POST", body: JSON.stringify({ menuId, kitchenId, enabled }) });
      notify({ level: "success", message: enabled ? "�S����L�������܂���" : "�S���𖳌������܂���" });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "�S���X�V�Ɏ��s���܂���" });
    }
  };

  const purge = async (target: "ORDERS" | "AUDIT_LOGS") => {
    const label = target === "ORDERS" ? "�����f�[�^" : "�č����O";
    if (!confirmDanger(`${label}��폜���܂��B�����ł��܂���B���s���܂����H`)) return;

    try {
      await apiFetch("/api/admin/purge", { method: "POST", body: JSON.stringify({ target, confirmationText: "DELETE" }) });
      notify({ level: "warning", message: `${label}��폜���܂���` });
      await reload();
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "�폜�Ɏ��s���܂���" });
    }
  };

  const assignmentMap = new Map(assignments.map((a) => [`${a.menuId}:${a.kitchenId}`, a.enabled]));

  if (loading || !session) {
    return <main>�ǂݍ��ݒ�...</main>;
  }

  return (
    <>
      <TerminalBanner actorId={session.actor.actorId} actorType={session.actor.actorType} actorLabel={session.actor.label} offlineActors={session.offlineActors} />
      <DashboardShell
        className="admin-shell"
        eyebrow="ADMIN CONTROL"
        title="�Ǘ��_�b�V���{�[�h"
        subtitle="�A�J�E���g�A�J�e�S���A���j���[�A�S���ݒ��܂Ƃ߂ĉ^�p"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/order-book">
                <Box20Regular />
                �I�[�_�[�u�b�N
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/audit">
                <AppsList20Regular />
                �č����O
              </Link>
            </Button>
          </div>
        }
      >
        <TooltipProvider delayDuration={120}>
          <div className="grid gap-3 xl:grid-cols-[1.08fr_0.92fr]">
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader title="�A�J�E���g" subtitle="����E��ԁE��������" icon={<span>�l</span>} />
              </CardHeader>
              <CardContent className="space-y-3">
                <Accordion type="single" collapsible defaultValue="new-actor" className="rounded-lg border px-3">
                  <AccordionItem value="new-actor" className="border-b-0">
                    <AccordionTrigger className="py-2 text-sm">�V�K�A�J�E���g��ǉ�</AccordionTrigger>
                    <AccordionContent>
                      <form onSubmit={createActor} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <Select value={newActorType} onValueChange={(value) => setNewActorType(value as Actor["actorType"])}>
                          <SelectTrigger>
                            <SelectValue placeholder="���[��" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="POS">POS</SelectItem>
                            <SelectItem value="KITCHEN">�L�b�`��</SelectItem>
                            <SelectItem value="WAITER">�z�V</SelectItem>
                          </SelectContent>
                        </Select>
                        {newActorType === "KITCHEN" && (
                          <Input placeholder="�\����" value={newKitchenDisplayOrder} onChange={(e) => setNewKitchenDisplayOrder(e.target.value)} />
                        )}
                        <Input placeholder="�\����" value={newActorLabel} onChange={(e) => setNewActorLabel(e.target.value)} required />
                        <Input placeholder="�p�X���[�h" value={newActorSecret} onChange={(e) => setNewActorSecret(e.target.value)} required />
                        <Button type="submit" className="sm:col-span-2 lg:col-span-1">
                          <Add20Regular />
                          �쐬
                        </Button>
                      </form>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <div className="grid gap-2">
                  {actors.map((actor) => (
                    <article key={actor.id} className="rounded-lg border bg-card/70 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <strong className="text-sm">{actor.label}</strong>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {labelOf(ACTOR_TYPE_LABEL, actor.actorType)}
                            {actor.actorType === "KITCHEN" ? ` / ${actor.kitchenEnabled ? "�ғ�" : "��~"} / ���� ${actor.kitchenDisplayOrder}` : ""}
                          </div>
                        </div>
                        <Badge variant={actor.online ? "secondary" : "outline"} className={actor.online ? "bg-emerald-100 text-emerald-800" : ""}>
                          {actor.online ? "ONLINE" : "OFFLINE"}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <IconActionButton
                          label="�\�����ύX"
                          icon={<Edit20Regular />}
                          disabled={!actor.isActive}
                          onClick={() => {
                            const next = prompt("�V�����\����", actor.label);
                            if (next && next !== actor.label) {
                              void updateActor(actor.id, { label: next }, "�\������X�V���܂���");
                            }
                          }}
                        />
                        <IconActionButton
                          label="�p�X���[�h�ύX"
                          icon={<Key20Regular />}
                          disabled={!actor.isActive}
                          onClick={() => {
                            const next = prompt("�V�����p�X���[�h", "");
                            if (next) {
                              void updateActor(actor.id, { secret: next }, "�p�X���[�h��X�V���܂���");
                            }
                          }}
                        />
                        {actor.actorType === "KITCHEN" && (
                          <>
                            <IconActionButton
                              label={actor.kitchenEnabled ? "�L�b�`����~" : "�L�b�`���ғ�"}
                              icon={<Power20Regular />}
                              disabled={!actor.isActive}
                              onClick={() => void toggleKitchenEnabled(actor)}
                            />
                            <IconActionButton
                              label="�L�b�`���\����"
                              icon={<ArrowUp20Regular />}
                              disabled={!actor.isActive}
                              onClick={() => {
                                const next = prompt("�L�b�`���\����", String(actor.kitchenDisplayOrder));
                                if (next != null && next.trim() !== "") {
                                  void updateActor(actor.id, { kitchenDisplayOrder: Number(next) }, "�L�b�`���\������X�V���܂���");
                                }
                              }}
                            />
                          </>
                        )}
                        <IconActionButton
                          label="�������O�A�E�g"
                          icon={<SignOut20Regular />}
                          disabled={!actor.isActive}
                          onClick={() => void forceLogout(actor.id)}
                        />
                        {actor.id !== "admin" && actor.actorType !== "MENU_DISPLAY" && (
                          <IconActionButton
                            label="�폜"
                            icon={<Delete20Regular />}
                            className="text-destructive hover:text-destructive"
                            disabled={!actor.isActive}
                            onClick={() => void deleteActor(actor)}
                          />
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <SectionHeader title="�J�e�S��" subtitle="���O�E���я�" icon={<span>��</span>} />
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input placeholder="�V�����J�e�S����" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} className="max-w-xs" />
                  <Button type="button" variant="outline" onClick={createCategory} disabled={!newCategoryName}>
                    <Add20Regular />
                    �ǉ�
                  </Button>
                </div>

                <div className="grid gap-2">
                  {activeCategories.map((category, index) => (
                    <article key={category.id} className="rounded-lg border bg-card/70 p-2.5">
                      <div className="flex items-center gap-2">
                        <Input
                          value={categoryNameDrafts[category.id] ?? category.name}
                          onChange={(e) => setCategoryNameDrafts((prev) => ({ ...prev, [category.id]: e.target.value }))}
                        />
                        <Badge variant="outline">#{category.displayOrder}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <IconActionButton
                          label="�ۑ�"
                          icon={<Save20Regular />}
                          onClick={() => {
                            void (async () => {
                              try {
                                await patchCategory(category.id, { name: categoryNameDrafts[category.id] ?? category.name }, "�J�e�S������X�V���܂���");
                                await reload();
                              } catch (e) {
                                notify({ level: "error", message: e instanceof Error ? e.message : "�J�e�S���X�V�Ɏ��s���܂���" });
                              }
                            })();
                          }}
                        />
                        <IconActionButton label="���" icon={<ArrowUp20Regular />} disabled={index === 0} onClick={() => void moveCategory(category.id, -1)} />
                        <IconActionButton
                          label="����"
                          icon={<ArrowDown20Regular />}
                          disabled={index === activeCategories.length - 1}
                          onClick={() => void moveCategory(category.id, 1)}
                        />
                        <IconActionButton
                          label="�폜"
                          icon={<Delete20Regular />}
                          className="text-destructive hover:text-destructive"
                          onClick={() => void deleteCategory(category)}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <SectionHeader title="���j���[" subtitle="�̔���ԁE�ҏW�E�S���ݒ�" icon={<span>�i</span>} />
            </CardHeader>
            <CardContent className="space-y-3">
              <Accordion type="single" collapsible defaultValue="new-menu" className="rounded-lg border px-3">
                <AccordionItem value="new-menu" className="border-b-0">
                  <AccordionTrigger className="py-2 text-sm">�V�K���j���[��ǉ�</AccordionTrigger>
                  <AccordionContent>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <Input placeholder="�V�������j���[��" value={newMenuName} onChange={(e) => setNewMenuName(e.target.value)} />
                      <Input placeholder="���i" value={newMenuPrice} onChange={(e) => setNewMenuPrice(e.target.value)} />
                      <Input placeholder="�����b��" value={newMenuWorkloadSeconds} onChange={(e) => setNewMenuWorkloadSeconds(e.target.value)} />
                      <Select value={newMenuCategoryId} onValueChange={setNewMenuCategoryId}>
                        <SelectTrigger>
                          <SelectValue placeholder="�J�e�S��" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeCategories.map((cat) => (
                            <SelectItem key={cat.id} value={cat.id}>
                              {cat.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        onClick={createMenu}
                        disabled={!newMenuName || !newMenuCategoryId || !newMenuPrice || !newMenuWorkloadSeconds}
                      >
                        <Add20Regular />
                        �ǉ�
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <Accordion type="single" collapsible className="space-y-2">
                {activeMenus.map((menu) => {
                  const edit = menuEdits[menu.id] ?? {
                    name: menu.name,
                    priceJpy: String(menu.priceJpy),
                    workloadSeconds: String(menu.workloadSeconds),
                    categoryId: menu.categoryId
                  };

                  return (
                    <AccordionItem key={menu.id} value={menu.id} className="rounded-lg border bg-card/70 px-3">
                      <AccordionTrigger className="py-3 hover:no-underline">
                        <div className="flex w-full flex-col gap-2 text-left md:flex-row md:items-center md:justify-between">
                          <div>
                            <strong className="text-sm">{menu.name}</strong>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {fmtJpy(menu.priceJpy)} / {menu.workloadSeconds}�b
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-1 md:min-w-72" onClick={(e) => e.stopPropagation()}>
                            {AVAILABILITY_OPTIONS.map((status) => {
                              const noCoverageForAvailable = status === "AVAILABLE" && !menu.hasActiveKitchenCoverage;
                              const pseudoDisabled = noCoverageForAvailable || menuAvailabilityBusyId === menu.id;
                              return (
                                <Button
                                  key={status}
                                  type="button"
                                  size="sm"
                                  variant={menu.availability === status ? "default" : "outline"}
                                  className={cn("h-7 px-2 text-[11px]", menu.availability === status && AVAILABILITY_TONE[status])}
                                  disabled={pseudoDisabled}
                                  onClick={() => void changeMenuAvailability(menu, status)}
                                >
                                  {labelOf(AVAILABILITY_LABEL, status)}
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-3">
                        <Separator />
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <Input value={edit.name} onChange={(e) => setMenuEdits((prev) => ({ ...prev, [menu.id]: { ...edit, name: e.target.value } }))} />
                          <Input
                            value={edit.priceJpy}
                            onChange={(e) => setMenuEdits((prev) => ({ ...prev, [menu.id]: { ...edit, priceJpy: e.target.value } }))}
                          />
                          <Input
                            value={edit.workloadSeconds}
                            onChange={(e) => setMenuEdits((prev) => ({ ...prev, [menu.id]: { ...edit, workloadSeconds: e.target.value } }))}
                          />
                          <Select
                            value={edit.categoryId}
                            onValueChange={(value) => setMenuEdits((prev) => ({ ...prev, [menu.id]: { ...edit, categoryId: value } }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="�J�e�S��" />
                            </SelectTrigger>
                            <SelectContent>
                              {activeCategories.map((cat) => (
                                <SelectItem key={cat.id} value={cat.id}>
                                  {cat.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex flex-wrap gap-1">
                          <IconActionButton label="�ۑ�" icon={<Save20Regular />} onClick={() => void saveMenuEdit(menu)} />
                          <IconActionButton label="���" icon={<ArrowUp20Regular />} onClick={() => void moveMenu(menu, -1)} />
                          <IconActionButton label="����" icon={<ArrowDown20Regular />} onClick={() => void moveMenu(menu, 1)} />
                          <IconActionButton
                            label="�폜"
                            icon={<Delete20Regular />}
                            className="text-destructive hover:text-destructive"
                            onClick={() => void deleteMenu(menu)}
                          />
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {kitchenActors.map((kitchen) => {
                            const key = `${menu.id}:${kitchen.id}`;
                            const enabled = assignmentMap.get(key) ?? false;
                            return (
                              <Button
                                key={key}
                                type="button"
                                size="sm"
                                variant={enabled ? "secondary" : "outline"}
                                onClick={() => void toggleAssignment(menu.id, kitchen.id, !enabled)}
                              >
                                {kitchen.label}: {enabled ? "�L��" : "����"}
                              </Button>
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
              <CardTitle className="text-sm">�f�[�^�폜</CardTitle>
              <CardDescription>�����s�̑���</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button type="button" variant="destructive" onClick={() => void purge("ORDERS")}>
                <Delete20Regular />
                �����f�[�^��폜
              </Button>
              <Button type="button" variant="destructive" onClick={() => void purge("AUDIT_LOGS")}>
                <Delete20Regular />
                �č����O��폜
              </Button>
            </CardContent>
          </Card>
        </TooltipProvider>
      </DashboardShell>
    </>
  );
}



