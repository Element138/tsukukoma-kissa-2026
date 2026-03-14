"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { AVAILABILITY_LABEL, labelOf } from "@/lib/labels";
import { useToast } from "@/components/toast";

type DisplayCategory = {
  id: string;
  name: string;
  menus: Array<{
    id: string;
    name: string;
    priceJpy: number;
    availability: "AVAILABLE" | "PAUSED" | "SOLD_OUT";
    leadTimeSecondsP75_30m: number | null;
    coverImageDataUrl: string | null;
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

function formatEta(seconds: number | null) {
  if (seconds == null) {
    return "-- 分";
  }
  return `${Math.max(1, Math.ceil(seconds / 60))} 分`;
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

export default function MenuDisplayPage() {
  const { loading, session } = useSession(["MENU_DISPLAY"]);
  const { notify } = useToast();

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
  const viewportRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const trackRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const categoryPages = useMemo(() => splitCategoryPages(categories), [categories]);
  const activePage = categoryPages[pageIndex] ?? [];
  const shouldFadeBetweenPages = categories.length > 3;

  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  const fetchDisplayData = async () => {
    return apiFetch<MenuDisplayPayload>("/api/menu-display");
  };

  const applyFetchedPayload = (payload: MenuDisplayPayload) => {
    const currentCategories = categoriesRef.current;
    const currentLayout = categoryLayoutSignature(currentCategories);
    const nextLayout = categoryLayoutSignature(payload.categories);

    setSettings(payload.settings ?? DEFAULT_SETTINGS);

    if (currentCategories.length === 0) {
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
        message:
          e instanceof Error ? e.message : "メニュー表示の取得に失敗しました",
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
      return;
    }
    if (pageIndex >= categoryPages.length) {
      setPageIndex(0);
    }
  }, [categoryPages.length, pageIndex]);

  useEffect(() => {
    if (activePage.length === 0) {
      return;
    }

    const animations: Animation[] = [];
    const pageDisplayMs = Math.max(
      6000,
      Math.floor((settings.pageDisplaySeconds || DEFAULT_SETTINGS.pageDisplaySeconds) * 1000),
    );

    const raf = window.requestAnimationFrame(() => {
      for (const category of activePage) {
        const viewport = viewportRefs.current[category.id];
        const track = trackRefs.current[category.id];
        if (!viewport || !track) {
          continue;
        }

        track.style.transform = "translateY(0px)";
        const overflowPx = Math.max(0, track.scrollHeight - viewport.clientHeight);
        if (overflowPx <= 1) {
          continue;
        }

        const waitMs = Math.floor(pageDisplayMs * 0.2);
        const moveEachMs = Math.floor((pageDisplayMs - waitMs * 2) / 2);
        const animation = track.animate(
          [
            { transform: "translateY(0px)", offset: 0 },
            { transform: `translateY(${-overflowPx}px)`, offset: moveEachMs / pageDisplayMs },
            {
              transform: `translateY(${-overflowPx}px)`,
              offset: (moveEachMs + waitMs) / pageDisplayMs,
            },
            {
              transform: "translateY(0px)",
              offset: (moveEachMs + waitMs + moveEachMs) / pageDisplayMs,
            },
            { transform: "translateY(0px)", offset: 1 },
          ],
          {
            duration: pageDisplayMs,
            easing: "linear",
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
        const committed = commitPendingCategoriesIfNeeded();
        if (!committed) {
          setCycleTick((prev) => prev + 1);
        }
        return;
      }

      if (!isLastPage) {
        if (shouldFadeBetweenPages) {
          setIsPageFading(true);
          fadeTimer = window.setTimeout(() => {
            setPageIndex((prev) => Math.min(prev + 1, categoryPages.length - 1));
            setIsPageFading(false);
          }, PAGE_FADE_MS);
          return;
        }
        setPageIndex((prev) => Math.min(prev + 1, categoryPages.length - 1));
        return;
      }

      if (shouldFadeBetweenPages) {
        setIsPageFading(true);
      }
      const onWrapped = () => {
        const committed = commitPendingCategoriesIfNeeded();
        if (!committed) {
          setPageIndex(0);
        }
        setIsPageFading(false);
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
    activePage,
    categoryPages.length,
    cycleTick,
    pageIndex,
    settings.pageDisplaySeconds,
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
                <h2>{category.name}</h2>
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
                    const unavailable = menu.availability !== "AVAILABLE";
                    return (
                      <article
                        key={menu.id}
                        className={`menu-display-row ${unavailable ? "unavailable" : ""}`}
                      >
                        <div className="menu-display-row-text">
                          <strong>{menu.name}</strong>
                          {unavailable ? (
                            <div className="menu-display-row-status">
                              {labelOf(AVAILABILITY_LABEL, menu.availability)}
                            </div>
                          ) : (
                            <div className="menu-display-row-meta">
                              <span>{fmtJpy(menu.priceJpy)}</span>
                              <span>
                                提供目安 {formatEta(menu.leadTimeSecondsP75_30m)}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="menu-display-row-image-wrap">
                          {menu.coverImageDataUrl && (
                            <img
                              src={menu.coverImageDataUrl}
                              alt={`${menu.name} の画像`}
                              className="menu-display-row-image"
                            />
                          )}
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
