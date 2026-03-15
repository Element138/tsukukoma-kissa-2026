"use client";

import {
  Fragment,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadDefaultJapaneseParser } from "budoux";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import {
  formatAllergenNotice,
  type SpecifiedAllergenKey,
} from "@/lib/allergens";
import { AVAILABILITY_LABEL, labelOf } from "@/lib/labels";
import { useToast } from "@/components/toast";

type DisplayCategory = {
  id: string;
  name: string;
  menus: Array<{
    id: string;
    name: string;
    priceJpy: number;
    availability: "AVAILABLE" | "INCREASED_WAIT" | "PAUSED" | "SOLD_OUT";
    coverImageDataUrl: string | null;
    allergens: SpecifiedAllergenKey[];
    customBadgeText: string | null;
    customBadgeColor: string | null;
  }>;
};

type MenuDisplaySettings = {
  pageDisplaySeconds: number;
};

type MenuDisplayPayload = {
  categories: DisplayCategory[];
  settings: MenuDisplaySettings;
};

const DEFAULT_SETTINGS: MenuDisplaySettings = {
  pageDisplaySeconds: 18,
};
const PAGE_FADE_MS = 750;

function resolvePageDisplayMs(pageDisplaySeconds: number | undefined) {
  const safeSeconds =
    Number.isFinite(pageDisplaySeconds) && (pageDisplaySeconds ?? 0) > 0
      ? (pageDisplaySeconds as number)
      : DEFAULT_SETTINGS.pageDisplaySeconds;
  return Math.max(6000, Math.floor(safeSeconds * 1000));
}

function splitCategoryPages(categories: DisplayCategory[]) {
  if (categories.length === 0) {
    return [] as DisplayCategory[][];
  }
  const columnsPerPage = Math.min(3, categories.length);
  const pages: DisplayCategory[][] = [];
  for (let i = 0; i < categories.length; i += columnsPerPage) {
    pages.push(categories.slice(i, i + columnsPerPage));
  }
  return pages;
}

function categoryLayoutSignature(categories: DisplayCategory[]) {
  return categories.map((category) => category.id).join("|");
}

function mergeMenusIntoCurrentLayout(
  currentCategories: DisplayCategory[],
  freshCategories: DisplayCategory[],
) {
  const freshByCategoryId = new Map(
    freshCategories.map((category) => [category.id, category]),
  );

  return currentCategories.map((currentCategory) => {
    const freshCategory = freshByCategoryId.get(currentCategory.id);
    if (!freshCategory) {
      return currentCategory;
    }
    return {
      ...currentCategory,
      menus: freshCategory.menus,
    };
  });
}

function splitLongKatakanaChunk(chunk: string) {
  const tokens: string[] = [];
  let cursor = 0;
  while (cursor < chunk.length) {
    const size = cursor === 0 ? 3 : 4;
    tokens.push(chunk.slice(cursor, cursor + size));
    cursor += size;
  }
  return tokens;
}

export default function MenuDisplayPage() {
  const { loading, session } = useSession(["MENU_DISPLAY"]);
  const { notify } = useToast();
  const parser = useMemo(() => loadDefaultJapaneseParser(), []);

  const [categories, setCategories] = useState<DisplayCategory[]>([]);
  const [settings, setSettings] = useState<MenuDisplaySettings>(DEFAULT_SETTINGS);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [isPageFading, setIsPageFading] = useState(false);
  const [cycleTick, setCycleTick] = useState(0);

  const categoriesRef = useRef<DisplayCategory[]>([]);
  const pendingCategorySnapshotRef = useRef<DisplayCategory[] | null>(null);
  const reloadInFlightRef = useRef(false);
  const queuedReloadRef = useRef(false);
  const activeCycleDurationMsRef = useRef(
    resolvePageDisplayMs(DEFAULT_SETTINGS.pageDisplaySeconds),
  );
  const pendingCycleDurationMsRef = useRef(
    resolvePageDisplayMs(DEFAULT_SETTINGS.pageDisplaySeconds),
  );
  const activePageRef = useRef<DisplayCategory[]>([]);
  const viewportRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const trackRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const categoryPages = useMemo(() => splitCategoryPages(categories), [categories]);
  const activePage = categoryPages[pageIndex] ?? [];
  const shouldFadeBetweenPages = categories.length > 3;
  const pageStructureSignature = useMemo(
    () =>
      categoryPages
        .map((page) => page.map((category) => category.id).join(","))
        .join("|"),
    [categoryPages],
  );

  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  useEffect(() => {
    activePageRef.current = activePage;
  }, [activePage]);

  useEffect(() => {
    pendingCycleDurationMsRef.current = resolvePageDisplayMs(
      settings.pageDisplaySeconds,
    );
  }, [settings.pageDisplaySeconds]);

  const fetchDisplayData = async () => {
    return apiFetch<MenuDisplayPayload>("/api/menu-display");
  };

  const applyFetchedPayload = (payload: MenuDisplayPayload) => {
    const currentCategories = categoriesRef.current;
    const currentLayout = categoryLayoutSignature(currentCategories);
    const nextLayout = categoryLayoutSignature(payload.categories);
    const nextSettings = payload.settings ?? DEFAULT_SETTINGS;
    const nextPageDisplayMs = resolvePageDisplayMs(nextSettings.pageDisplaySeconds);

    setSettings(nextSettings);
    pendingCycleDurationMsRef.current = nextPageDisplayMs;

    if (currentCategories.length === 0) {
      activeCycleDurationMsRef.current = nextPageDisplayMs;
      categoriesRef.current = payload.categories;
      setCategories(payload.categories);
      setPageIndex(0);
      pendingCategorySnapshotRef.current = null;
      return;
    }

    if (currentLayout === nextLayout) {
      categoriesRef.current = payload.categories;
      setCategories(payload.categories);
      return;
    }

    pendingCategorySnapshotRef.current = payload.categories;
    const merged = mergeMenusIntoCurrentLayout(currentCategories, payload.categories);
    categoriesRef.current = merged;
    setCategories(merged);
  };

  const reload = async () => {
    if (reloadInFlightRef.current) {
      queuedReloadRef.current = true;
      return;
    }
    reloadInFlightRef.current = true;

    try {
      const payload = await fetchDisplayData();
      applyFetchedPayload(payload);
    } catch (e) {
      notify({
        level: "error",
        message: e instanceof Error ? e.message : "メニュー表示の更新に失敗しました",
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
    if (!session) {
      return;
    }
    void reload();
  }, [session]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (categoryPages.length === 0) {
      setPageIndex(0);
      setIsPageFading(false);
      return;
    }
    if (pageIndex >= categoryPages.length) {
      setPageIndex(0);
    }
  }, [categoryPages.length, pageIndex]);

  useEffect(() => {
    setIsPageFading(false);
    const currentActivePage = activePageRef.current;
    if (currentActivePage.length === 0) {
      return;
    }

    const animations: Animation[] = [];
    const pageDisplayMs = activeCycleDurationMsRef.current;

    const raf = window.requestAnimationFrame(() => {
      for (const category of currentActivePage) {
        const viewport = viewportRefs.current[category.id];
        const track = trackRefs.current[category.id];
        if (!viewport || !track) {
          continue;
        }

        track.style.transform = "translateY(0px)";

        const viewportStyle = window.getComputedStyle(viewport);
        const viewportPaddingY =
          (Number.parseFloat(viewportStyle.paddingTop) || 0) +
          (Number.parseFloat(viewportStyle.paddingBottom) || 0);
        const visibleHeight = Math.max(
          0,
          viewport.clientHeight - viewportPaddingY,
        );
        const overflowPx = Math.max(0, track.scrollHeight - visibleHeight + 2);
        if (overflowPx <= 1) {
          continue;
        }

        const animation = track.animate(
          [
            { transform: "translateY(0px)", offset: 0 },
            { transform: "translateY(0px)", offset: 0.2 },
            { transform: `translateY(${-overflowPx * 0.08}px)`, offset: 0.32 },
            { transform: `translateY(${-overflowPx}px)`, offset: 0.82 },
            { transform: `translateY(${-overflowPx}px)`, offset: 1 },
          ],
          {
            duration: pageDisplayMs,
            easing: "cubic-bezier(0.28, 0.08, 0.24, 1)",
            iterations: 1,
            fill: "both",
          },
        );
        animations.push(animation);
      }
    });

    let fadeTimer: number | null = null;

    const moveToNext = () => {
      const hasMultiplePages = categoryPages.length > 1;
      const isLastPage = pageIndex >= categoryPages.length - 1;
      const applyCycleDurationForNextPage = () => {
        activeCycleDurationMsRef.current = pendingCycleDurationMsRef.current;
      };

      const commitPendingCategoriesIfNeeded = () => {
        const pending = pendingCategorySnapshotRef.current;
        if (!pending) {
          return false;
        }
        pendingCategorySnapshotRef.current = null;
        categoriesRef.current = pending;
        setCategories(pending);
        setPageIndex(0);
        return true;
      };

      if (!hasMultiplePages) {
        applyCycleDurationForNextPage();
        const committed = commitPendingCategoriesIfNeeded();
        if (!committed) {
          setCycleTick((prev) => prev + 1);
        }
        return;
      }

      if (!isLastPage) {
        const goNextPage = () => {
          applyCycleDurationForNextPage();
          setPageIndex((prev) => Math.min(prev + 1, categoryPages.length - 1));
          setIsPageFading(false);
          setCycleTick((prev) => prev + 1);
        };
        if (shouldFadeBetweenPages) {
          setIsPageFading(true);
          fadeTimer = window.setTimeout(goNextPage, PAGE_FADE_MS);
          return;
        }
        goNextPage();
        return;
      }

      if (shouldFadeBetweenPages) {
        setIsPageFading(true);
      }

      const onWrapped = () => {
        applyCycleDurationForNextPage();
        const committed = commitPendingCategoriesIfNeeded();
        if (!committed) {
          setPageIndex(0);
        }
        setIsPageFading(false);
        setCycleTick((prev) => prev + 1);
      };

      if (shouldFadeBetweenPages) {
        fadeTimer = window.setTimeout(onWrapped, PAGE_FADE_MS);
      } else {
        onWrapped();
      }
    };

    const timer = window.setTimeout(moveToNext, pageDisplayMs);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      if (fadeTimer != null) {
        window.clearTimeout(fadeTimer);
      }
      for (const animation of animations) {
        animation.cancel();
      }
    };
  }, [
    cycleTick,
    pageIndex,
    pageStructureSignature,
    shouldFadeBetweenPages,
  ]);

  useRealtimeSubscription({
    enabled: Boolean(session),
    channels: ["menus", "categories", "orders"],
    onEvent: () => {
      void reload();
    },
    onResync: () => {
      void reload();
    },
  });

  if (loading || !session) {
    return <LoadingScreen />;
  }

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      notify({
        level: "error",
        message: e instanceof Error ? e.message : "全画面切替に失敗しました",
      });
    }
  };

  const columnCount = Math.min(3, Math.max(1, activePage.length));

  const renderBudouX = (text: string) => {
    const chunks = parser
      .parse(text)
      .flatMap((chunk) => {
        const regex = /[ァ-ヶー]{6,}/g;
        const parts: string[] = [];
        let cursor = 0;
        for (const match of chunk.matchAll(regex)) {
          const start = match.index ?? 0;
          if (start > cursor) {
            parts.push(chunk.slice(cursor, start));
          }
          parts.push(...splitLongKatakanaChunk(match[0]));
          cursor = start + match[0].length;
        }
        if (cursor < chunk.length) {
          parts.push(chunk.slice(cursor));
        }
        return parts.length > 0 ? parts : [chunk];
      })
      .filter((chunk) => chunk.length > 0);

    return chunks.map((chunk, index) => (
      <Fragment key={index}>
        {chunk}
        {index < chunks.length - 1 ? <wbr /> : null}
      </Fragment>
    ));
  };

  return (
    <>
      {!isFullscreen && (
        <TerminalBanner
          actorId={session.actor.actorId}
          actorType={session.actor.actorType}
          actorLabel={session.actor.label}
          offlineActors={session.offlineActors}
        />
      )}

      <DashboardShell
        eyebrow="MENU"
        title="メニュー"
        fancyHeader
        className={
          isFullscreen ? "menu-display-fullscreen" : "menu-display-standard"
        }
        actions={
          <button
            type="button"
            className="ghost-btn"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? "全画面を終了" : "全画面表示"}
          </button>
        }
      >
        <div
          className={`menu-display-columns ${isPageFading ? "is-fading" : ""}`}
          style={
            {
              "--menu-display-columns": String(columnCount),
            } as CSSProperties
          }
        >
          {activePage.map((category) => (
            <section key={category.id} className="menu-display-category">
              <header className="menu-display-category-header">
                <h2>{renderBudouX(category.name)}</h2>
              </header>
              <div
                className="menu-display-scroll-viewport"
                ref={(el) => {
                  viewportRefs.current[category.id] = el;
                }}
              >
                <div
                  className="menu-display-scroll-track"
                  ref={(el) => {
                    trackRefs.current[category.id] = el;
                  }}
                >
                  {category.menus.map((menu) => {
                    const unavailable =
                      menu.availability === "PAUSED" ||
                      menu.availability === "SOLD_OUT";
                    const showIncreasedWait =
                      menu.availability === "INCREASED_WAIT";
                    const imageSrc = menu.coverImageDataUrl;
                    const hasImage = Boolean(imageSrc);
                    const allergenNotice = formatAllergenNotice(menu.allergens);
                    const hasAllergenWarning = menu.allergens.length > 0;
                    const badgeText = menu.customBadgeText?.trim() ?? "";
                    const badgeColor = menu.customBadgeColor?.trim() || "#d97706";

                    return (
                      <article
                        key={menu.id}
                        className={`menu-display-row ${unavailable ? "unavailable" : ""}`}
                        style={
                          badgeText
                            ? ({
                                borderColor: badgeColor,
                                borderWidth: "2px",
                              } as CSSProperties)
                            : undefined
                        }
                      >
                        <div className="menu-display-row-text">
                          {badgeText ? (
                            <span
                              className="menu-display-row-badge"
                              style={{ backgroundColor: badgeColor }}
                            >
                              {badgeText}
                            </span>
                          ) : null}
                          <strong>{renderBudouX(menu.name)}</strong>
                          <div
                            className={`menu-display-row-allergen ${hasAllergenWarning ? "has-allergen" : "none"}`}
                          >
                            {allergenNotice}
                          </div>
                          {unavailable ? (
                            <div className="menu-display-row-status">
                              {labelOf(AVAILABILITY_LABEL, menu.availability)}
                            </div>
                          ) : (
                            <div className="menu-display-row-meta">
                              <span className="menu-display-row-price">
                                {fmtJpy(menu.priceJpy)}
                              </span>
                              {showIncreasedWait ? (
                                <span className="menu-display-row-wait">
                                  お時間をいただきます
                                </span>
                              ) : null}
                            </div>
                          )}
                        </div>
                        <div
                          className={`menu-display-row-image-wrap ${hasImage ? "" : "is-empty"}`}
                        >
                          {hasImage ? (
                            <img
                              src={imageSrc ?? undefined}
                              alt={`${menu.name} の画像`}
                              className="menu-display-row-image"
                            />
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          ))}
        </div>
      </DashboardShell>
    </>
  );
}
