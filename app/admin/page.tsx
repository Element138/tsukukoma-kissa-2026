"use client";

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  type InputHTMLAttributes,
  ReactNode,
  useCallback,
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
import { LoadingScreen } from "@/components/loading-screen";
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
import {
  allergenLabelOf,
  normalizeSpecifiedAllergens,
  SPECIFIED_ALLERGENS,
  type SpecifiedAllergenKey,
} from "@/lib/allergens";
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
  displayOrder: number | null;
  isActive: boolean;
};
type Menu = {
  id: string;
  name: string;
  priceJpy: number;
  availability: "AVAILABLE" | "INCREASED_WAIT" | "PAUSED" | "SOLD_OUT";
  workloadSeconds: number;
  displayOrder: number | null;
  categoryId: string;
  assignedKitchenId: string | null;
  isActive: boolean;
  hasActiveKitchenCoverage: boolean;
  coverImageDataUrl: string | null;
  allergensJson: SpecifiedAllergenKey[];
  customBadgeText: string | null;
  customBadgeColor: string | null;
  dailyOrderCap: number | null;
  lowStockBadgeEnabled: boolean;
  lowStockBadgeThreshold: number;
  todayOrderCount: number;
  remainingUntilCap: number | null;
  isCapReached: boolean;
};
type MenuEdit = {
  name: string;
  priceJpy: string;
  categoryId: string;
  kitchenId: string;
  coverImageDataUrl: string;
  allergens: SpecifiedAllergenKey[];
  customBadgeText: string;
  customBadgeColor: string;
  dailyOrderCap: string;
  lowStockBadgeEnabled: boolean;
  lowStockBadgeThreshold: string;
};
type MenuDisplaySettings = {
  pageDisplaySeconds: number;
};

type MenuCoverUploadData = {
  url: string;
};

const MAX_MENU_COVER_FILE_BYTES = 1_000_000;
const MENU_COVER_OUTPUT_TYPE = "image/webp";
const MENU_COVER_INITIAL_QUALITY = 0.9;
const MENU_COVER_MIN_QUALITY = 0.5;
const MENU_COVER_SCALE_FACTOR = 0.82;
const MENU_COVER_MAX_ATTEMPTS = 12;
const MENU_COVER_SUPPORTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const AVAILABILITY_OPTIONS: Array<Menu["availability"]> = [
  "AVAILABLE",
  "INCREASED_WAIT",
  "PAUSED",
  "SOLD_OUT",
];
const STATUS_BUTTON_ACTIVE_TONE: Record<Menu["availability"], string> = {
  AVAILABLE:
    "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700",
  INCREASED_WAIT: "border-amber-700 bg-amber-500 text-white hover:bg-amber-600",
  PAUSED: "border-orange-700 bg-orange-500 text-white hover:bg-orange-600",
  SOLD_OUT: "border-rose-700 bg-rose-600 text-white hover:bg-rose-700",
};
const BADGE_COLOR_HEX_REGEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_MENU_WORKLOAD_SECONDS = 300;
const LOW_STOCK_BADGE_THRESHOLD_UNLIMITED = 100000;

const dangerConfirm = (message: string) => window.confirm(message);

function sanitizeIntegerInput(value: string) {
  return value.replace(/[^\d]/g, "");
}

function replaceExtensionWithWebp(filename: string) {
  const trimmed = filename.trim();
  if (!trimmed) {
    return "menu-cover.webp";
  }
  return trimmed.replace(/\.[^.]+$/, "") + ".webp";
}

function loadImageFromObjectUrl(objectUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("画像ファイルを読み込めませんでした"));
    image.src = objectUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  contentType: string,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("画像圧縮に失敗しました"));
          return;
        }
        resolve(blob);
      },
      contentType,
      quality,
    );
  });
}

async function compressMenuCoverFile(file: File): Promise<File> {
  if (!MENU_COVER_SUPPORTED_TYPES.has(file.type)) {
    throw new Error("PNG / JPEG / WebP 形式の画像を選択してください");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageFromObjectUrl(objectUrl);
    let scale = 1;
    let quality = MENU_COVER_INITIAL_QUALITY;

    for (let attempt = 0; attempt < MENU_COVER_MAX_ATTEMPTS; attempt += 1) {
      const width = Math.max(1, Math.floor(image.naturalWidth * scale));
      const height = Math.max(1, Math.floor(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("画像処理の初期化に失敗しました");
      }

      context.drawImage(image, 0, 0, width, height);
      const compressedBlob = await canvasToBlob(
        canvas,
        MENU_COVER_OUTPUT_TYPE,
        quality,
      );

      if (compressedBlob.size <= MAX_MENU_COVER_FILE_BYTES) {
        return new File([compressedBlob], replaceExtensionWithWebp(file.name), {
          type: MENU_COVER_OUTPUT_TYPE,
          lastModified: Date.now(),
        });
      }

      if (quality > MENU_COVER_MIN_QUALITY) {
        quality = Math.max(MENU_COVER_MIN_QUALITY, quality - 0.1);
      } else {
        scale *= MENU_COVER_SCALE_FACTOR;
        quality = MENU_COVER_INITIAL_QUALITY;
      }
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  throw new Error("画像を 1MB 以下に圧縮できませんでした");
}

async function uploadMenuCoverFile(file: File): Promise<MenuCoverUploadData> {
  const formData = new FormData();
  formData.set("file", file, file.name);

  const response = await fetch("/api/admin/menu-covers/upload", {
    method: "POST",
    body: formData,
  });

  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    data?: MenuCoverUploadData;
    error?: { message?: string };
  } | null;

  if (!response.ok || !payload?.ok || !payload.data?.url) {
    throw new Error(
      payload?.error?.message ?? "画像アップロードに失敗しました",
    );
  }

  return payload.data;
}

function toPositiveFiniteNumber(
  raw: string,
  fieldLabel: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${fieldLabel}を入力してください`);
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldLabel}は数値で入力してください`);
  }
  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`${fieldLabel}は整数で入力してください`);
  }
  if (options.min != null && value < options.min) {
    throw new Error(`${fieldLabel}は ${options.min} 以上で入力してください`);
  }
  if (options.max != null && value > options.max) {
    throw new Error(`${fieldLabel}は ${options.max} 以下で入力してください`);
  }
  return value;
}

function toMenuEdit(menu: Menu): MenuEdit {
  return {
    name: menu.name,
    priceJpy: String(menu.priceJpy),
    categoryId: menu.categoryId,
    kitchenId: menu.assignedKitchenId ?? "",
    coverImageDataUrl: menu.coverImageDataUrl ?? "",
    allergens: normalizeSpecifiedAllergens(menu.allergensJson),
    customBadgeText: menu.customBadgeText ?? "",
    customBadgeColor: menu.customBadgeColor ?? "#d97706",
    dailyOrderCap: menu.dailyOrderCap == null ? "" : String(menu.dailyOrderCap),
    lowStockBadgeEnabled: Boolean(menu.lowStockBadgeEnabled),
    lowStockBadgeThreshold:
      (menu.lowStockBadgeThreshold ?? 0) >= LOW_STOCK_BADGE_THRESHOLD_UNLIMITED
        ? ""
        : String(menu.lowStockBadgeThreshold ?? 0),
  };
}

function SectionHeader(props: { title: string; icon: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-8 w-8 place-items-center rounded-md border bg-muted/30 text-foreground">
        {props.icon}
      </div>
      <div>
        <h2 className="text-sm font-semibold leading-none tracking-tight">
          {props.title}
        </h2>
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
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  min?: number;
  max?: number;
  step?: number;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className={cn("grid gap-0", props.className)}>
      <span className="text-[11px] font-medium leading-none text-muted-foreground">
        {props.label}
      </span>
      <Input
        value={props.value}
        placeholder={props.placeholder}
        type={props.type}
        inputMode={props.inputMode}
        min={props.min}
        max={props.max}
        step={props.step}
        onKeyDown={props.onKeyDown}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

function IconActionButton(props: {
  label: string;
  icon: ReactNode;
  destructive?: boolean;
  saveTone?: boolean;
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
            props.saveTone && "admin-save-button",
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
  const { notify, clearByPrefix } = useToast();

  const [actors, setActors] = useState<Actor[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

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
  const [newMenuKitchenId, setNewMenuKitchenId] = useState("");
  const [newMenuCoverImageDataUrl, setNewMenuCoverImageDataUrl] = useState("");
  const [newMenuCoverUploadBusy, setNewMenuCoverUploadBusy] = useState(false);
  const [newMenuAllergens, setNewMenuAllergens] = useState<
    SpecifiedAllergenKey[]
  >([]);
  const [newMenuCustomBadgeText, setNewMenuCustomBadgeText] = useState("");
  const [newMenuCustomBadgeColor, setNewMenuCustomBadgeColor] =
    useState("#d97706");
  const [newMenuDailyOrderCap, setNewMenuDailyOrderCap] = useState("");
  const [newMenuLowStockBadgeThreshold, setNewMenuLowStockBadgeThreshold] =
    useState("");
  const [menuEdits, setMenuEdits] = useState<Record<string, MenuEdit>>({});
  const [menuDisplaySettings, setMenuDisplaySettings] =
    useState<MenuDisplaySettings | null>(null);
  const [pageDisplaySecondsDraft, setPageDisplaySecondsDraft] = useState("18");
  const [menuAvailabilityBusyId, setMenuAvailabilityBusyId] = useState<
    string | null
  >(null);
  const [didBootstrap, setDidBootstrap] = useState(false);

  const reloadInFlightRef = useRef(false);
  const queuedReloadRef = useRef(false);
  const hasSettledWithoutUnsavedRef = useRef(false);
  const saveAllChangesRef = useRef<() => Promise<void>>(async () => {});

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
            (a.displayOrder ?? 9999) - (b.displayOrder ?? 9999) ||
            a.name.localeCompare(b.name, "ja"),
        ),
    [categories],
  );
  const categoryOrder = useMemo(
    () =>
      new Map(
        activeCategories.map((c) => [
          c.id,
          c.displayOrder ?? Number.MAX_SAFE_INTEGER,
        ]),
      ),
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
            (a.displayOrder ?? 9999) - (b.displayOrder ?? 9999) ||
            a.name.localeCompare(b.name, "ja"),
        ),
    [menus, categoryOrder],
  );
  const hasUnsavedChanges = useMemo(() => {
    const categoryDirty = activeCategories.some(
      (category) =>
        (categoryNameDrafts[category.id] ?? category.name) !== category.name,
    );

    const menuDirty = activeMenus.some((menu) => {
      const edit = menuEdits[menu.id];
      if (!edit) {
        return false;
      }
      const normalizedCover = edit.coverImageDataUrl.trim();
      const menuCover = menu.coverImageDataUrl ?? "";
      const normalizedEditAllergens = normalizeSpecifiedAllergens(
        edit.allergens,
      );
      const normalizedMenuAllergens = normalizeSpecifiedAllergens(
        menu.allergensJson,
      );
      const editBadgeText = edit.customBadgeText.trim();
      const menuBadgeText = (menu.customBadgeText ?? "").trim();
      const editBadgeColor = editBadgeText ? edit.customBadgeColor.trim() : "";
      const menuBadgeColor = menuBadgeText
        ? (menu.customBadgeColor ?? "").trim()
        : "";
      const dailyOrderCap =
        edit.dailyOrderCap.trim() === ""
          ? null
          : Number(edit.dailyOrderCap.trim());
      const lowStockBadgeThreshold =
        edit.lowStockBadgeThreshold.trim() === ""
          ? LOW_STOCK_BADGE_THRESHOLD_UNLIMITED
          : Number(edit.lowStockBadgeThreshold.trim());
      const menuLowStockBadgeThreshold =
        (menu.lowStockBadgeThreshold ?? 0) >=
        LOW_STOCK_BADGE_THRESHOLD_UNLIMITED
          ? LOW_STOCK_BADGE_THRESHOLD_UNLIMITED
          : (menu.lowStockBadgeThreshold ?? 0);
      return (
        edit.name !== menu.name ||
        Number(edit.priceJpy) !== menu.priceJpy ||
        edit.categoryId !== menu.categoryId ||
        edit.kitchenId !== (menu.assignedKitchenId ?? "") ||
        normalizedCover !== menuCover ||
        normalizedEditAllergens.join(",") !==
          normalizedMenuAllergens.join(",") ||
        editBadgeText !== menuBadgeText ||
        editBadgeColor !== menuBadgeColor ||
        dailyOrderCap !== (menu.dailyOrderCap ?? null) ||
        lowStockBadgeThreshold !== menuLowStockBadgeThreshold
      );
    });

    const draftSeconds = Number(pageDisplaySecondsDraft);
    const displaySettingDirty =
      menuDisplaySettings != null &&
      (pageDisplaySecondsDraft.trim() !==
        String(menuDisplaySettings.pageDisplaySeconds) ||
        !Number.isFinite(draftSeconds));

    return categoryDirty || menuDirty || displaySettingDirty;
  }, [
    activeCategories,
    activeMenus,
    categoryNameDrafts,
    menuEdits,
    menuDisplaySettings,
    pageDisplaySecondsDraft,
  ]);

  const reload = async () => {
    if (reloadInFlightRef.current) {
      queuedReloadRef.current = true;
      return;
    }
    reloadInFlightRef.current = true;
    try {
      const [a, m, c, settings] = await Promise.all([
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
        apiFetch<{ settings: MenuDisplaySettings }>(
          "/api/admin/menu-display-settings",
          {
            timeoutMs: 5000,
            retry: 1,
          },
        ),
      ]);
      setActors(a.actors);
      setMenus(m.menus);
      setCategories(c.categories);
      setMenuDisplaySettings(settings.settings);
      setPageDisplaySecondsDraft((prev) => {
        const previousServerValue = menuDisplaySettings?.pageDisplaySeconds;
        if (
          previousServerValue != null &&
          prev !== String(previousServerValue)
        ) {
          return prev;
        }
        return String(settings.settings.pageDisplaySeconds);
      });
      setCategoryNameDrafts((prev) =>
        Object.fromEntries(
          c.categories.map((cat) => [cat.id, prev[cat.id] ?? cat.name]),
        ),
      );
      setMenuEdits((prev) => {
        const next = { ...prev };
        for (const menu of m.menus) {
          next[menu.id] = next[menu.id] ?? toMenuEdit(menu);
        }
        return next;
      });
      const firstActiveCategory = c.categories.find(
        (category) => category.isActive,
      );
      if (!newMenuCategoryId && firstActiveCategory) {
        setNewMenuCategoryId(firstActiveCategory.id);
      }
      const firstKitchen = a.actors
        .filter((row) => row.actorType === "KITCHEN" && row.isActive)
        .sort(
          (x, y) =>
            x.kitchenDisplayOrder - y.kitchenDisplayOrder ||
            x.label.localeCompare(y.label, "ja"),
        )[0];
      if (!newMenuKitchenId && firstKitchen) {
        setNewMenuKitchenId(firstKitchen.id);
      }
      window.setTimeout(() => {
        setDidBootstrap(true);
      }, 0);
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "管理データの更新に失敗しました",
      });
    } finally {
      reloadInFlightRef.current = false;
      if (queuedReloadRef.current) {
        queuedReloadRef.current = false;
        void reload();
      }
    }
  };

  useEffect(() => {
    if (!session) return;
    void reload();
  }, [session]);

  useRealtimeSubscription({
    enabled: Boolean(session),
    channels: ["actors", "menus", "categories"],
    onEvent: () => void reload(),
    onResync: () => void reload(),
  });

  useEffect(() => {
    if (
      !didBootstrap ||
      !hasUnsavedChanges ||
      !hasSettledWithoutUnsavedRef.current
    ) {
      return;
    }

    const beforeUnloadHandler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const navigateHandler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]");
      if (!anchor) {
        return;
      }
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) {
        return;
      }
      const nextUrl = new URL(href, window.location.href);
      if (nextUrl.origin !== window.location.origin) {
        return;
      }
      const currentPath = `${window.location.pathname}${window.location.search}`;
      const nextPath = `${nextUrl.pathname}${nextUrl.search}`;
      if (currentPath === nextPath) {
        return;
      }
      const okToLeave = window.confirm(
        "未保存の変更があります。このままページを移動しますか？",
      );
      if (!okToLeave) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", beforeUnloadHandler);
    document.addEventListener("click", navigateHandler, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnloadHandler);
      document.removeEventListener("click", navigateHandler, true);
    };
  }, [didBootstrap, hasUnsavedChanges]);

  const updateActor = async (
    id: string,
    patch: Record<string, unknown>,
    successMessage: string,
  ) => {
    await runMutation({
      action: async () => {
        await apiFetch("/api/admin/actors", {
          method: "PATCH",
          body: JSON.stringify({ id, ...patch }),
        });
      },
      successMessage,
      errorMessage: "アカウント更新に失敗しました",
    });
  };

  const createActor = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedLabel = newActorLabel.trim();
    const trimmedSecret = newActorSecret.trim();
    if (!trimmedLabel) {
      notify({ level: "error", message: "アカウント名を入力してください" });
      return;
    }
    if (trimmedSecret.length < 4) {
      notify({
        level: "error",
        message: "パスワードは 4 文字以上で入力してください",
      });
      return;
    }

    const saved = await runMutation({
      action: async () => {
        await apiFetch("/api/admin/actors", {
          method: "POST",
          body: JSON.stringify({
            actorType: newActorType,
            label: trimmedLabel,
            secret: trimmedSecret,
            ...(newActorType === "KITCHEN" ? { kitchenEnabled: true } : {}),
          }),
        });
      },
      successMessage: "アカウントを作成しました",
      errorMessage: "アカウント作成に失敗しました",
    });

    if (saved) {
      setNewActorLabel("");
      setNewActorSecret("");
    }
  };

  const notifyError = (error: unknown, fallbackMessage: string) => {
    notify({
      level: "error",
      message: error instanceof Error ? error.message : fallbackMessage,
    });
  };

  const runMutation = async (params: {
    action: () => Promise<void>;
    successMessage: string;
    errorMessage: string;
    reloadAfter?: boolean;
  }) => {
    try {
      await params.action();
      notify({ level: "success", message: params.successMessage });
      if (params.reloadAfter ?? true) {
        await reload();
      }
      return true;
    } catch (error) {
      notifyError(error, params.errorMessage);
      return false;
    }
  };

  const patchCategory = async (id: string, patch: Partial<Category>) => {
    await apiFetch("/api/admin/categories", {
      method: "PATCH",
      body: JSON.stringify({ id, ...patch }),
    });
  };
  const patchMenu = async (menuId: string, patch: Record<string, unknown>) => {
    await apiFetch("/api/admin/menus", {
      method: "PATCH",
      body: JSON.stringify({ id: menuId, ...patch }),
    });
  };

  const parseMenuInput = (params: {
    name: string;
    priceJpy: string;
    categoryId: string;
    kitchenId: string;
    coverImageDataUrl: string;
    allergens: SpecifiedAllergenKey[];
    customBadgeText: string;
    customBadgeColor: string;
    dailyOrderCap: string;
    lowStockBadgeEnabled: boolean;
    lowStockBadgeThreshold: string;
  }) => {
    const trimmedName = params.name.trim();
    if (!trimmedName) {
      throw new Error("メニュー名を入力してください");
    }
    if (trimmedName.length > 120) {
      throw new Error("メニュー名は 120 文字以内で入力してください");
    }

    const priceJpy = toPositiveFiniteNumber(params.priceJpy, "価格 (円)", {
      integer: true,
      min: 0,
      max: 100000,
    });
    if (!params.categoryId) {
      throw new Error("カテゴリを選択してください");
    }
    if (!params.kitchenId) {
      throw new Error("担当キッチンを選択してください");
    }

    const normalizedAllergens = normalizeSpecifiedAllergens(params.allergens);
    const customBadgeText = params.customBadgeText.trim();
    const customBadgeColor = params.customBadgeColor.trim();
    if (customBadgeText && !BADGE_COLOR_HEX_REGEX.test(customBadgeColor)) {
      throw new Error("バッジ色は #RRGGBB 形式で入力してください");
    }
    const dailyOrderCapRaw = params.dailyOrderCap.trim();
    const dailyOrderCap =
      dailyOrderCapRaw === ""
        ? null
        : toPositiveFiniteNumber(dailyOrderCapRaw, "日次上限", {
            integer: true,
            min: 1,
            max: 100000,
          });
    const lowStockBadgeThresholdRaw = params.lowStockBadgeThreshold.trim();
    const lowStockBadgeEnabled = lowStockBadgeThresholdRaw !== "";
    const lowStockBadgeThreshold = !lowStockBadgeEnabled
      ? LOW_STOCK_BADGE_THRESHOLD_UNLIMITED
      : toPositiveFiniteNumber(lowStockBadgeThresholdRaw, "在庫バッジ閾値", {
          integer: true,
          min: 0,
          max: LOW_STOCK_BADGE_THRESHOLD_UNLIMITED,
        });
    if (lowStockBadgeEnabled && dailyOrderCap == null) {
      throw new Error("残数バッジを使う場合は日次上限を設定してください");
    }

    return {
      name: trimmedName,
      priceJpy,
      categoryId: params.categoryId,
      kitchenId: params.kitchenId,
      coverImageDataUrl: params.coverImageDataUrl.trim() || null,
      allergensJson: normalizedAllergens,
      customBadgeText: customBadgeText || null,
      customBadgeColor: customBadgeText ? customBadgeColor : null,
      dailyOrderCap,
      lowStockBadgeEnabled,
      lowStockBadgeThreshold,
    };
  };

  const saveMenuDisplaySettings = async () => {
    let pageDisplaySeconds: number;
    try {
      pageDisplaySeconds = toPositiveFiniteNumber(
        pageDisplaySecondsDraft,
        "表示時間",
        {
          integer: true,
          min: 6,
          max: 120,
        },
      );
    } catch (error) {
      notifyError(error, "表示時間は 6〜120 秒で入力してください");
      return;
    }

    try {
      const data = await apiFetch<{ settings: MenuDisplaySettings }>(
        "/api/admin/menu-display-settings",
        {
          method: "PATCH",
          body: JSON.stringify({
            pageDisplaySeconds,
          }),
        },
      );
      setMenuDisplaySettings(data.settings);
      setPageDisplaySecondsDraft(String(data.settings.pageDisplaySeconds));
      notify({ level: "success", message: "表示サイクル設定を保存しました" });
    } catch (e) {
      notify({
        level: "error",
        message: e instanceof Error ? e.message : "設定の保存に失敗しました",
      });
    }
  };

  const saveAllChanges = useCallback(async () => {
    const categoryUpdates = activeCategories
      .map((category) => ({
        id: category.id,
        nextName: (categoryNameDrafts[category.id] ?? category.name).trim(),
        currentName: category.name,
      }))
      .filter((row) => row.nextName !== row.currentName);

    const menuUpdates: Array<{
      menuId: string;
      parsedInput: ReturnType<typeof parseMenuInput>;
    }> = [];
    let nextDisplaySeconds: number | null = null;

    try {
      for (const menu of activeMenus) {
        const edit = menuEdits[menu.id];
        if (!edit) {
          continue;
        }
        const normalizedCover = edit.coverImageDataUrl.trim();
        const menuCover = menu.coverImageDataUrl ?? "";
        const normalizedEditAllergens = normalizeSpecifiedAllergens(
          edit.allergens,
        );
        const normalizedMenuAllergens = normalizeSpecifiedAllergens(
          menu.allergensJson,
        );
        const editBadgeText = edit.customBadgeText.trim();
        const menuBadgeText = (menu.customBadgeText ?? "").trim();
        const editBadgeColor = editBadgeText
          ? edit.customBadgeColor.trim()
          : "";
        const menuBadgeColor = menuBadgeText
          ? (menu.customBadgeColor ?? "").trim()
          : "";
        const dailyOrderCap =
          edit.dailyOrderCap.trim() === ""
            ? null
            : Number(edit.dailyOrderCap.trim());
        const lowStockBadgeThreshold =
          edit.lowStockBadgeThreshold.trim() === ""
            ? LOW_STOCK_BADGE_THRESHOLD_UNLIMITED
            : Number(edit.lowStockBadgeThreshold.trim());
        const menuLowStockBadgeThreshold =
          (menu.lowStockBadgeThreshold ?? 0) >=
          LOW_STOCK_BADGE_THRESHOLD_UNLIMITED
            ? LOW_STOCK_BADGE_THRESHOLD_UNLIMITED
            : (menu.lowStockBadgeThreshold ?? 0);
        const isDirty =
          edit.name !== menu.name ||
          Number(edit.priceJpy) !== menu.priceJpy ||
          edit.categoryId !== menu.categoryId ||
          edit.kitchenId !== (menu.assignedKitchenId ?? "") ||
          normalizedCover !== menuCover ||
          normalizedEditAllergens.join(",") !==
            normalizedMenuAllergens.join(",") ||
          editBadgeText !== menuBadgeText ||
          editBadgeColor !== menuBadgeColor ||
          dailyOrderCap !== (menu.dailyOrderCap ?? null) ||
          lowStockBadgeThreshold !== menuLowStockBadgeThreshold;

        if (!isDirty) {
          continue;
        }

        menuUpdates.push({
          menuId: menu.id,
          parsedInput: parseMenuInput({
            name: edit.name,
            priceJpy: edit.priceJpy,
            categoryId: edit.categoryId,
            kitchenId: edit.kitchenId,
            coverImageDataUrl: edit.coverImageDataUrl,
            allergens: edit.allergens,
            customBadgeText: edit.customBadgeText,
            customBadgeColor: edit.customBadgeColor,
            dailyOrderCap: edit.dailyOrderCap,
            lowStockBadgeEnabled: edit.lowStockBadgeEnabled,
            lowStockBadgeThreshold: edit.lowStockBadgeThreshold,
          }),
        });
      }

      const draftSeconds = Number(pageDisplaySecondsDraft);
      const displaySettingDirty =
        menuDisplaySettings != null &&
        (pageDisplaySecondsDraft.trim() !==
          String(menuDisplaySettings.pageDisplaySeconds) ||
          !Number.isFinite(draftSeconds));
      nextDisplaySeconds = displaySettingDirty
        ? toPositiveFiniteNumber(pageDisplaySecondsDraft, "表示時間", {
            integer: true,
            min: 6,
            max: 120,
          })
        : null;

      if (
        categoryUpdates.length === 0 &&
        menuUpdates.length === 0 &&
        nextDisplaySeconds == null
      ) {
        return;
      }

      for (const categoryUpdate of categoryUpdates) {
        if (!categoryUpdate.nextName) {
          throw new Error("カテゴリ名を入力してください");
        }
        await patchCategory(categoryUpdate.id, {
          name: categoryUpdate.nextName,
        });
      }

      for (const menuUpdate of menuUpdates) {
        await patchMenu(menuUpdate.menuId, menuUpdate.parsedInput);
      }

      if (nextDisplaySeconds != null) {
        const data = await apiFetch<{ settings: MenuDisplaySettings }>(
          "/api/admin/menu-display-settings",
          {
            method: "PATCH",
            body: JSON.stringify({
              pageDisplaySeconds: nextDisplaySeconds,
            }),
          },
        );
        setMenuDisplaySettings(data.settings);
        setPageDisplaySecondsDraft(String(data.settings.pageDisplaySeconds));
      }

      notify({ level: "success", message: "変更をすべて保存しました" });
      await reload();
    } catch (error) {
      notifyError(error, "一括保存に失敗しました");
    }
  }, [
    activeCategories,
    activeMenus,
    categoryNameDrafts,
    menuDisplaySettings,
    menuEdits,
    notifyError,
    pageDisplaySecondsDraft,
    parseMenuInput,
    patchCategory,
    patchMenu,
    notify,
    reload,
  ]);
  saveAllChangesRef.current = saveAllChanges;

  useEffect(() => {
    if (!didBootstrap) {
      return;
    }
    if (!hasUnsavedChanges) {
      hasSettledWithoutUnsavedRef.current = true;
      clearByPrefix("admin-unsaved-warning");
      return;
    }
    if (!hasSettledWithoutUnsavedRef.current) {
      return;
    }
    if (hasUnsavedChanges) {
      notify({
        id: "admin-unsaved-warning",
        level: "warning",
        sticky: true,
        message: "未保存の変更があります。保存してください。",
        actions: [
          {
            label: "すべて保存",
            onClick: () => {
              void saveAllChangesRef.current();
            },
          },
        ],
      });
      return;
    }
  }, [clearByPrefix, didBootstrap, hasUnsavedChanges, notify]);

  const moveMenu = async (menu: Menu, direction: -1 | 1) => {
    const siblingMenus = activeMenus.filter(
      (row) => row.categoryId === menu.categoryId,
    );
    const index = siblingMenus.findIndex((row) => row.id === menu.id);
    const target = siblingMenus[index + direction];
    if (!target || menu.displayOrder == null || target.displayOrder == null) {
      return;
    }

    await runMutation({
      action: async () => {
        await Promise.all([
          patchMenu(menu.id, { displayOrder: target.displayOrder }),
          patchMenu(target.id, { displayOrder: menu.displayOrder }),
        ]);
      },
      successMessage: "メニュー順を更新しました",
      errorMessage: "メニュー順の更新に失敗しました",
    });
  };

  const uploadMenuCover = async (menu: Menu, file: File) => {
    try {
      const compressed = await compressMenuCoverFile(file);
      const uploaded = await uploadMenuCoverFile(compressed);
      await patchMenu(menu.id, { coverImageDataUrl: uploaded.url });
      setMenuEdits((prev) => ({
        ...prev,
        [menu.id]: {
          ...(prev[menu.id] ?? toMenuEdit(menu)),
          coverImageDataUrl: uploaded.url,
        },
      }));
      notify({ level: "success", message: "メニュー画像を更新しました" });
      await reload();
    } catch (e) {
      notify({
        level: "error",
        message: e instanceof Error ? e.message : "画像更新に失敗しました",
      });
    }
  };

  const uploadNewMenuCover = async (file: File) => {
    setNewMenuCoverUploadBusy(true);
    try {
      const compressed = await compressMenuCoverFile(file);
      const uploaded = await uploadMenuCoverFile(compressed);
      setNewMenuCoverImageDataUrl(uploaded.url);
      notify({
        level: "success",
        message: "新規メニュー画像をアップロードしました",
      });
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error
            ? e.message
            : "新規メニュー画像のアップロードに失敗しました",
      });
    } finally {
      setNewMenuCoverUploadBusy(false);
    }
  };

  if (loading || !session) return <LoadingScreen />;

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
        title="管理者パネル"
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
                <SectionHeader title="アカウント" icon={<PersonFilled />} />
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
                              <SelectItem value="WAITER">ウェイター</SelectItem>
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
                            const trimmed = next?.trim();
                            if (!trimmed) {
                              return;
                            }
                            if (trimmed !== actor.label)
                              void updateActor(
                                actor.id,
                                { label: trimmed },
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
                            const trimmed = next?.trim();
                            if (!trimmed) {
                              return;
                            }
                            if (trimmed.length < 4) {
                              notify({
                                level: "error",
                                message:
                                  "パスワードは 4 文字以上で入力してください",
                              });
                              return;
                            }
                            if (trimmed)
                              void updateActor(
                                actor.id,
                                { secret: trimmed },
                                "パスワードを更新しました",
                              );
                          }}
                        />
                        <IconActionButton
                          label="強制ログアウト"
                          icon={<SignOut20Regular />}
                          disabled={!actor.isActive}
                          onClick={() =>
                            void runMutation({
                              action: async () => {
                                await apiFetch(
                                  "/api/admin/sessions/force-logout",
                                  {
                                    method: "POST",
                                    body: JSON.stringify({ actorId: actor.id }),
                                  },
                                );
                              },
                              successMessage:
                                "セッションを強制ログアウトしました",
                              errorMessage: "強制ログアウトに失敗しました",
                            })
                          }
                        />
                        {actor.actorType === "KITCHEN" && (
                          <label className="ml-1 inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                            <span className="text-muted-foreground">
                              注文を受け付ける
                            </span>
                            <Switch
                              checked={actor.kitchenEnabled}
                              disabled={!actor.isActive}
                              onCheckedChange={(checked) =>
                                void runMutation({
                                  action: async () => {
                                    await apiFetch("/api/kitchen/toggle", {
                                      method: "POST",
                                      body: JSON.stringify({
                                        kitchenId: actor.id,
                                        kitchenEnabled: checked,
                                      }),
                                    });
                                  },
                                  successMessage: checked
                                    ? "注文を受け付けるようにしました"
                                    : "注文を受け付けないようにしました",
                                  errorMessage:
                                    "注文受付状態の更新に失敗しました",
                                })
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
                                    void runMutation({
                                      action: async () => {
                                        await apiFetch(
                                          `/api/admin/actors?id=${encodeURIComponent(actor.id)}`,
                                          { method: "DELETE" },
                                        );
                                      },
                                      successMessage:
                                        "アカウントを削除しました",
                                      errorMessage:
                                        "アカウント削除に失敗しました",
                                    });
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
                  title="メニューカテゴリ"
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
                      const trimmedName = newCategoryName.trim();
                      if (!trimmedName) {
                        notify({
                          level: "error",
                          message: "カテゴリ名を入力してください",
                        });
                        return;
                      }

                      const nextDisplayOrder =
                        activeCategories.reduce(
                          (max, category) =>
                            Math.max(max, category.displayOrder ?? 0),
                          0,
                        ) + 1;

                      const saved = await runMutation({
                        action: async () => {
                          await apiFetch("/api/admin/categories", {
                            method: "POST",
                            body: JSON.stringify({
                              name: trimmedName,
                              displayOrder: nextDisplayOrder,
                            }),
                          });
                        },
                        successMessage: "カテゴリを追加しました",
                        errorMessage: "カテゴリ追加に失敗しました",
                      });

                      if (saved) {
                        setNewCategoryName("");
                      }
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
                        <Badge variant="outline">
                          #{cat.displayOrder ?? "-"}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <IconActionButton
                          label="保存"
                          icon={<Save20Regular />}
                          saveTone
                          onClick={() =>
                            void (async () => {
                              const nextName = (
                                categoryNameDrafts[cat.id] ?? cat.name
                              ).trim();
                              if (!nextName) {
                                notify({
                                  level: "error",
                                  message: "カテゴリ名を入力してください",
                                });
                                return;
                              }
                              const saved = await runMutation({
                                action: async () => {
                                  await patchCategory(cat.id, {
                                    name: nextName,
                                  });
                                },
                                successMessage: "カテゴリ名を更新しました",
                                errorMessage: "カテゴリ名の更新に失敗しました",
                              });
                              if (saved) {
                                setCategoryNameDrafts((prev) => ({
                                  ...prev,
                                  [cat.id]: nextName,
                                }));
                              }
                            })()
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
                              if (
                                !target ||
                                cat.displayOrder == null ||
                                target.displayOrder == null
                              ) {
                                return;
                              }
                              await runMutation({
                                action: async () => {
                                  await Promise.all([
                                    patchCategory(cat.id, {
                                      displayOrder: target.displayOrder,
                                    }),
                                    patchCategory(target.id, {
                                      displayOrder: cat.displayOrder,
                                    }),
                                  ]);
                                },
                                successMessage: "カテゴリ順を更新しました",
                                errorMessage: "カテゴリ順の更新に失敗しました",
                              });
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
                              if (
                                !target ||
                                cat.displayOrder == null ||
                                target.displayOrder == null
                              ) {
                                return;
                              }
                              await runMutation({
                                action: async () => {
                                  await Promise.all([
                                    patchCategory(cat.id, {
                                      displayOrder: target.displayOrder,
                                    }),
                                    patchCategory(target.id, {
                                      displayOrder: cat.displayOrder,
                                    }),
                                  ]);
                                },
                                successMessage: "カテゴリ順を更新しました",
                                errorMessage: "カテゴリ順の更新に失敗しました",
                              });
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
                                void runMutation({
                                  action: async () => {
                                    await apiFetch(
                                      `/api/admin/categories?id=${encodeURIComponent(cat.id)}`,
                                      { method: "DELETE" },
                                    );
                                  },
                                  successMessage: "カテゴリを削除しました",
                                  errorMessage: "カテゴリ削除に失敗しました",
                                });
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
                    <div className="space-y-3">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <InputField
                          label="メニュー名"
                          value={newMenuName}
                          onChange={setNewMenuName}
                        />
                        <InputField
                          label="価格 (円)"
                          value={newMenuPrice}
                          onChange={(value) =>
                            setNewMenuPrice(sanitizeIntegerInput(value))
                          }
                          inputMode="numeric"
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
                        <label className="grid gap-0">
                          <span className="text-[11px] font-medium leading-none text-muted-foreground">
                            担当キッチン
                          </span>
                          <Select
                            value={newMenuKitchenId}
                            onValueChange={setNewMenuKitchenId}
                          >
                            <SelectTrigger className="bg-background text-foreground">
                              <SelectValue placeholder="キッチン" />
                            </SelectTrigger>
                            <SelectContent>
                              {kitchenActors.map((kitchen) => (
                                <SelectItem key={kitchen.id} value={kitchen.id}>
                                  {kitchen.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card/70 p-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium">
                          {newMenuCoverUploadBusy
                            ? "画像アップロード中..."
                            : "画像をアップロード"}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            disabled={newMenuCoverUploadBusy}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) {
                                void uploadNewMenuCover(file);
                              }
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        {newMenuCoverImageDataUrl ? (
                          <>
                            <span className="text-xs text-muted-foreground">
                              画像アップロード済み
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setNewMenuCoverImageDataUrl("")}
                            >
                              画像を削除
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            画像未設定（任意）
                          </span>
                        )}
                      </div>
                      <div className="grid gap-2 rounded-md border bg-card/70 p-3">
                        <div className="text-xs font-semibold text-muted-foreground">
                          特定原材料（8品目）
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {SPECIFIED_ALLERGENS.map((allergen) => {
                            const selected = newMenuAllergens.includes(
                              allergen.key,
                            );
                            return (
                              <Button
                                key={allergen.key}
                                type="button"
                                size="sm"
                                variant={selected ? "default" : "outline"}
                                className={cn(
                                  "h-8 px-3 text-xs",
                                  selected
                                    ? "border-amber-700 bg-amber-500 text-white hover:bg-amber-600"
                                    : "bg-background text-foreground hover:bg-muted",
                                )}
                                onClick={() =>
                                  setNewMenuAllergens((prev) => {
                                    const current =
                                      normalizeSpecifiedAllergens(prev);
                                    const next = current.includes(allergen.key)
                                      ? current.filter(
                                          (row) => row !== allergen.key,
                                        )
                                      : [...current, allergen.key];
                                    return normalizeSpecifiedAllergens(next);
                                  })
                                }
                              >
                                {allergen.label}
                              </Button>
                            );
                          })}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {newMenuAllergens.length > 0
                            ? `選択中: ${newMenuAllergens
                                .map((key) => allergenLabelOf(key))
                                .join("、")}`
                            : "選択中: 特定原材料なし"}
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <InputField
                          label="カスタムバッジ文言"
                          value={newMenuCustomBadgeText}
                          onChange={(value) =>
                            setNewMenuCustomBadgeText(value.slice(0, 32))
                          }
                          placeholder="例: おすすめ"
                        />
                        <label className="grid gap-0">
                          <span className="text-[11px] font-medium leading-none text-muted-foreground">
                            バッジ色
                          </span>
                          <Input
                            type="color"
                            value={
                              BADGE_COLOR_HEX_REGEX.test(
                                newMenuCustomBadgeColor,
                              )
                                ? newMenuCustomBadgeColor
                                : "#d97706"
                            }
                            className="h-9 w-20 p-1"
                            onChange={(event) =>
                              setNewMenuCustomBadgeColor(event.target.value)
                            }
                          />
                        </label>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <InputField
                          label="日次注文上限 (空欄で無制限)"
                          value={newMenuDailyOrderCap}
                          onChange={(value) =>
                            setNewMenuDailyOrderCap(sanitizeIntegerInput(value))
                          }
                          inputMode="numeric"
                          placeholder="例: 120"
                        />
                        <InputField
                          label="販促バッジを表示する残数閾値 (空欄で常時非表示)"
                          value={newMenuLowStockBadgeThreshold}
                          onChange={(value) =>
                            setNewMenuLowStockBadgeThreshold(
                              sanitizeIntegerInput(value),
                            )
                          }
                          inputMode="numeric"
                          placeholder="例: 10"
                        />
                      </div>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          className="self-end"
                          onClick={async () => {
                            let parsedInput: ReturnType<typeof parseMenuInput>;
                            try {
                              parsedInput = parseMenuInput({
                                name: newMenuName,
                                priceJpy: newMenuPrice,
                                categoryId: newMenuCategoryId,
                                kitchenId: newMenuKitchenId,
                                coverImageDataUrl: newMenuCoverImageDataUrl,
                                allergens: newMenuAllergens,
                                customBadgeText: newMenuCustomBadgeText,
                                customBadgeColor: newMenuCustomBadgeColor,
                                dailyOrderCap: newMenuDailyOrderCap,
                                lowStockBadgeEnabled:
                                  newMenuLowStockBadgeThreshold.trim() !== "",
                                lowStockBadgeThreshold:
                                  newMenuLowStockBadgeThreshold,
                              });
                            } catch (error) {
                              notifyError(error, "入力内容を確認してください");
                              return;
                            }

                            const nextDisplayOrder =
                              activeMenus
                                .filter(
                                  (row) =>
                                    row.categoryId === parsedInput.categoryId,
                                )
                                .reduce(
                                  (max, row) =>
                                    Math.max(max, row.displayOrder ?? 0),
                                  0,
                                ) + 1;

                            const saved = await runMutation({
                              action: async () => {
                                await apiFetch("/api/admin/menus", {
                                  method: "POST",
                                  body: JSON.stringify({
                                    ...parsedInput,
                                    availability: "PAUSED",
                                    workloadSeconds:
                                      DEFAULT_MENU_WORKLOAD_SECONDS,
                                    displayOrder: nextDisplayOrder,
                                    showLeadTime: true,
                                  }),
                                });
                              },
                              successMessage: "メニューを追加しました",
                              errorMessage: "メニュー追加に失敗しました",
                            });

                            if (saved) {
                              setNewMenuName("");
                              setNewMenuPrice("500");
                              setNewMenuCoverImageDataUrl("");
                              setNewMenuAllergens([]);
                              setNewMenuCustomBadgeText("");
                              setNewMenuCustomBadgeColor("#d97706");
                              setNewMenuDailyOrderCap("");
                              setNewMenuLowStockBadgeThreshold("");
                            }
                          }}
                          disabled={
                            !newMenuName ||
                            !newMenuCategoryId ||
                            !newMenuKitchenId ||
                            !newMenuPrice ||
                            newMenuCoverUploadBusy ||
                            kitchenActors.length === 0
                          }
                        >
                          <Add20Regular />
                          追加
                        </Button>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              <Accordion type="single" collapsible className="space-y-2">
                {activeMenus.map((menu) => {
                  const edit = menuEdits[menu.id] ?? toMenuEdit(menu);
                  const assignedKitchenLabel =
                    kitchenActors.find(
                      (row) => row.id === menu.assignedKitchenId,
                    )?.label ?? "未設定";
                  const sameCategoryMenus = activeMenus.filter(
                    (row) => row.categoryId === menu.categoryId,
                  );
                  const sameCategoryIndex = sameCategoryMenus.findIndex(
                    (row) => row.id === menu.id,
                  );
                  const isFirstInCategory = sameCategoryIndex <= 0;
                  const isLastInCategory =
                    sameCategoryIndex === sameCategoryMenus.length - 1;
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
                              {fmtJpy(menu.priceJpy)} / {assignedKitchenLabel}
                              {menu.dailyOrderCap != null
                                ? ` / 本日 ${menu.todayOrderCount} (残り ${menu.remainingUntilCap ?? 0} / 上限 ${menu.dailyOrderCap})`
                                : ` / 本日 ${menu.todayOrderCount}`}
                            </div>
                          </div>
                          <div
                            className="grid grid-cols-4 gap-1 md:min-w-72"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {AVAILABILITY_OPTIONS.map((status) => {
                              const noCoverage =
                                (status === "AVAILABLE" ||
                                  status === "INCREASED_WAIT") &&
                                !menu.hasActiveKitchenCoverage;
                              const capBlockedStatus =
                                menu.isCapReached &&
                                (status === "AVAILABLE" ||
                                  status === "INCREASED_WAIT" ||
                                  status === "PAUSED");
                              const disabled =
                                menuAvailabilityBusyId === menu.id ||
                                capBlockedStatus;
                              const active = menu.availability === status;
                              return (
                                <Button
                                  key={status}
                                  type="button"
                                  variant={active ? "default" : "outline"}
                                  disabled={disabled}
                                  className={cn(
                                    "h-8 px-2 text-[11px] font-semibold leading-none",
                                    (noCoverage || capBlockedStatus) &&
                                      !active &&
                                      "opacity-50",
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
                                      if (capBlockedStatus) {
                                        notify({
                                          level: "error",
                                          message:
                                            "本日の上限に達しているため変更できません",
                                        });
                                        return;
                                      }
                                      setMenuAvailabilityBusyId(menu.id);
                                      try {
                                        await runMutation({
                                          action: async () => {
                                            await patchMenu(menu.id, {
                                              availability: status,
                                            });
                                          },
                                          successMessage:
                                            "販売状態を更新しました",
                                          errorMessage:
                                            "販売状態の更新に失敗しました",
                                        });
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
                                [menu.id]: {
                                  ...edit,
                                  priceJpy: sanitizeIntegerInput(v),
                                },
                              }))
                            }
                            inputMode="numeric"
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
                          <label className="grid gap-0">
                            <span className="text-[11px] font-medium leading-none text-muted-foreground">
                              担当キッチン
                            </span>
                            <Select
                              value={edit.kitchenId}
                              onValueChange={(v) =>
                                setMenuEdits((p) => ({
                                  ...p,
                                  [menu.id]: { ...edit, kitchenId: v },
                                }))
                              }
                            >
                              <SelectTrigger className="bg-background text-foreground">
                                <SelectValue placeholder="キッチン" />
                              </SelectTrigger>
                              <SelectContent>
                                {kitchenActors.map((kitchen) => (
                                  <SelectItem
                                    key={kitchen.id}
                                    value={kitchen.id}
                                  >
                                    {kitchen.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                        </div>
                        <div className="grid gap-2 rounded-md border bg-card/70 p-3">
                          <div className="text-xs font-semibold text-muted-foreground">
                            特定原材料（8品目）
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {SPECIFIED_ALLERGENS.map((allergen) => {
                              const selected = edit.allergens.includes(
                                allergen.key,
                              );
                              return (
                                <Button
                                  key={allergen.key}
                                  type="button"
                                  size="sm"
                                  variant={selected ? "default" : "outline"}
                                  className={cn(
                                    "h-8 px-3 text-xs",
                                    selected
                                      ? "border-amber-700 bg-amber-500 text-white hover:bg-amber-600"
                                      : "bg-background text-foreground hover:bg-muted",
                                  )}
                                  onClick={() =>
                                    setMenuEdits((prev) => {
                                      const current =
                                        normalizeSpecifiedAllergens(
                                          prev[menu.id]?.allergens ??
                                            edit.allergens,
                                        );
                                      const next = current.includes(
                                        allergen.key,
                                      )
                                        ? current.filter(
                                            (row) => row !== allergen.key,
                                          )
                                        : [...current, allergen.key];
                                      return {
                                        ...prev,
                                        [menu.id]: {
                                          ...edit,
                                          allergens:
                                            normalizeSpecifiedAllergens(next),
                                        },
                                      };
                                    })
                                  }
                                >
                                  {allergen.label}
                                </Button>
                              );
                            })}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {edit.allergens.length > 0
                              ? `選択中: ${edit.allergens
                                  .map((key) => allergenLabelOf(key))
                                  .join("、")}`
                              : "選択中: 特定原材料なし"}
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <InputField
                            label="カスタムバッジ文言"
                            value={edit.customBadgeText}
                            onChange={(value) =>
                              setMenuEdits((prev) => ({
                                ...prev,
                                [menu.id]: {
                                  ...edit,
                                  customBadgeText: value.slice(0, 32),
                                },
                              }))
                            }
                            placeholder="例: おすすめ"
                          />
                          <label className="grid gap-0">
                            <span className="text-[11px] font-medium leading-none text-muted-foreground">
                              バッジ色
                            </span>
                            <Input
                              type="color"
                              value={
                                BADGE_COLOR_HEX_REGEX.test(
                                  edit.customBadgeColor,
                                )
                                  ? edit.customBadgeColor
                                  : "#d97706"
                              }
                              className="h-9 w-20 p-1"
                              onChange={(event) =>
                                setMenuEdits((prev) => ({
                                  ...prev,
                                  [menu.id]: {
                                    ...edit,
                                    customBadgeColor: event.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <InputField
                            label="日次上限 (空欄=無制限)"
                            value={edit.dailyOrderCap}
                            onChange={(value) =>
                              setMenuEdits((prev) => ({
                                ...prev,
                                [menu.id]: {
                                  ...edit,
                                  dailyOrderCap: sanitizeIntegerInput(value),
                                },
                              }))
                            }
                            inputMode="numeric"
                            placeholder="例: 120"
                          />
                          <InputField
                            label="残数バッジ閾値 (空欄=無制限)"
                            value={edit.lowStockBadgeThreshold}
                            onChange={(value) =>
                              setMenuEdits((prev) => ({
                                ...prev,
                                [menu.id]: {
                                  ...edit,
                                  lowStockBadgeThreshold:
                                    sanitizeIntegerInput(value),
                                },
                              }))
                            }
                            inputMode="numeric"
                            placeholder="例: 10 / 空欄で無制限"
                          />
                        </div>
                        <div className="row wrap">
                          <span className="muted text-xs">
                            本日のカウント: {menu.todayOrderCount}
                            {menu.dailyOrderCap != null
                              ? ` / 残り ${menu.remainingUntilCap ?? 0}`
                              : ""}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (
                                !dangerConfirm(
                                  `「${menu.name}」の本日カウントをリセットします。よろしいですか？`,
                                )
                              ) {
                                return;
                              }
                              void runMutation({
                                action: async () => {
                                  await apiFetch(
                                    "/api/admin/menus/reset-count",
                                    {
                                      method: "POST",
                                      body: JSON.stringify({ menuId: menu.id }),
                                    },
                                  );
                                },
                                successMessage:
                                  "本日のカウントをリセットしました",
                                errorMessage:
                                  "カウントのリセットに失敗しました",
                              });
                            }}
                          >
                            カウントをリセット
                          </Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card/70 p-2">
                          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium">
                            画像をアップロード
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  void uploadMenuCover(menu, file);
                                }
                                e.currentTarget.value = "";
                              }}
                            />
                          </label>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void runMutation({
                                action: async () => {
                                  await patchMenu(menu.id, {
                                    coverImageDataUrl: null,
                                  });
                                  setMenuEdits((prev) => ({
                                    ...prev,
                                    [menu.id]: {
                                      ...edit,
                                      coverImageDataUrl: "",
                                    },
                                  }));
                                },
                                successMessage: "メニュー画像を削除しました",
                                errorMessage:
                                  "メニュー画像の削除に失敗しました",
                              })
                            }
                          >
                            画像を削除
                          </Button>
                          {/* <span className="text-xs text-muted-foreground">
                            推奨: 横長画像 / 1MB 以下
                          </span> */}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <IconActionButton
                            label="保存"
                            icon={<Save20Regular />}
                            saveTone
                            onClick={() =>
                              void (async () => {
                                let parsedInput: ReturnType<
                                  typeof parseMenuInput
                                >;
                                try {
                                  parsedInput = parseMenuInput({
                                    name: edit.name,
                                    priceJpy: edit.priceJpy,
                                    categoryId: edit.categoryId,
                                    kitchenId: edit.kitchenId,
                                    coverImageDataUrl: edit.coverImageDataUrl,
                                    allergens: edit.allergens,
                                    customBadgeText: edit.customBadgeText,
                                    customBadgeColor: edit.customBadgeColor,
                                    dailyOrderCap: edit.dailyOrderCap,
                                    lowStockBadgeEnabled:
                                      edit.lowStockBadgeEnabled,
                                    lowStockBadgeThreshold:
                                      edit.lowStockBadgeThreshold,
                                  });
                                } catch (error) {
                                  notifyError(
                                    error,
                                    "入力内容を確認してください",
                                  );
                                  return;
                                }

                                const saved = await runMutation({
                                  action: async () => {
                                    await patchMenu(menu.id, parsedInput);
                                  },
                                  successMessage: "メニューを更新しました",
                                  errorMessage: "メニュー更新に失敗しました",
                                });
                                if (saved) {
                                  setMenuEdits((prev) => ({
                                    ...prev,
                                    [menu.id]: {
                                      ...prev[menu.id],
                                      name: parsedInput.name,
                                      priceJpy: String(parsedInput.priceJpy),
                                      categoryId: parsedInput.categoryId,
                                      kitchenId: parsedInput.kitchenId,
                                      coverImageDataUrl:
                                        parsedInput.coverImageDataUrl ?? "",
                                      allergens: normalizeSpecifiedAllergens(
                                        parsedInput.allergensJson,
                                      ),
                                      customBadgeText:
                                        parsedInput.customBadgeText ?? "",
                                      customBadgeColor:
                                        parsedInput.customBadgeColor ??
                                        "#d97706",
                                      dailyOrderCap:
                                        parsedInput.dailyOrderCap == null
                                          ? ""
                                          : String(parsedInput.dailyOrderCap),
                                      lowStockBadgeEnabled:
                                        parsedInput.lowStockBadgeEnabled,
                                      lowStockBadgeThreshold:
                                        parsedInput.lowStockBadgeThreshold >=
                                        LOW_STOCK_BADGE_THRESHOLD_UNLIMITED
                                          ? ""
                                          : String(
                                              parsedInput.lowStockBadgeThreshold,
                                            ),
                                    },
                                  }));
                                }
                              })()
                            }
                          />
                          <IconActionButton
                            label="上へ"
                            icon={<ArrowUp20Regular />}
                            disabled={isFirstInCategory}
                            onClick={() => void moveMenu(menu, -1)}
                          />
                          <IconActionButton
                            label="下へ"
                            icon={<ArrowDown20Regular />}
                            disabled={isLastInCategory}
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
                                  void runMutation({
                                    action: async () => {
                                      await patchMenu(menu.id, {
                                        isActive: false,
                                      });
                                    },
                                    successMessage: "メニューを削除しました",
                                    errorMessage: "メニュー削除に失敗しました",
                                  });
                              }}
                            />
                          </div>
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
              <CardTitle className="text-sm">メニュー表示サイクル</CardTitle>
              <CardDescription>
                ページ表示時間 (秒) に応じてスクロール速度を自動調整
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <InputField
                label="1ページ表示時間 (秒)"
                value={pageDisplaySecondsDraft}
                onChange={(value) =>
                  setPageDisplaySecondsDraft(sanitizeIntegerInput(value))
                }
                className="max-w-xs"
                inputMode="numeric"
              />
              <Button
                type="button"
                className="admin-save-button"
                onClick={() => void saveMenuDisplaySettings()}
                disabled={
                  menuDisplaySettings == null ||
                  Number(pageDisplaySecondsDraft) ===
                    menuDisplaySettings.pageDisplaySeconds
                }
              >
                <Save20Regular />
                設定を保存
              </Button>
              <span className="text-xs text-muted-foreground">6〜120 秒</span>
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
                    void runMutation({
                      action: async () => {
                        await apiFetch("/api/admin/purge", {
                          method: "POST",
                          body: JSON.stringify({
                            target: "ORDERS",
                            confirmationText: "DELETE",
                          }),
                        });
                      },
                      successMessage: "注文データを削除しました",
                      errorMessage: "注文データ削除に失敗しました",
                    });
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
                    void runMutation({
                      action: async () => {
                        await apiFetch("/api/admin/purge", {
                          method: "POST",
                          body: JSON.stringify({
                            target: "AUDIT_LOGS",
                            confirmationText: "DELETE",
                          }),
                        });
                      },
                      successMessage: "監査ログを削除しました",
                      errorMessage: "監査ログ削除に失敗しました",
                    });
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
