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

const HOLD_MS = 1800;
const MIN_PAGE_DWELL_MS = 9000;
const PAGE_FADE_MS = 900;

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

export default function MenuDisplayPage() {
  const { loading, session } = useSession(["MENU_DISPLAY"]);
  const { notify } = useToast();

  const [categories, setCategories] = useState<DisplayCategory[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [isPageFading, setIsPageFading] = useState(false);
  const reloadInFlightRef = useRef(false);
  const viewportRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const trackRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const categoryPages = useMemo(() => splitCategoryPages(categories), [categories]);
  const activePage = categoryPages[pageIndex] ?? [];

  const reload = async () => {
    if (reloadInFlightRef.current) {
      return;
    }
    reloadInFlightRef.current = true;

    try {
      const data = await apiFetch<{ categories: DisplayCategory[] }>(
        "/api/menu-display",
      );
      setCategories(data.categories);
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "メニュー表示の取得に失敗しました",
      });
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
    setPageIndex((prev) => prev % categoryPages.length);
  }, [categoryPages.length]);

  useEffect(() => {
    if (activePage.length === 0) {
      return;
    }

    const cleanups: Array<() => void> = [];
    const animations: Animation[] = [];
    const raf = window.requestAnimationFrame(() => {
      let longestCycleMs = 0;

      for (const category of activePage) {
        const viewport = viewportRefs.current[category.id];
        const track = trackRefs.current[category.id];
        if (!viewport || !track) {
          continue;
        }

        track.style.transform = "translateY(0px)";

        const overflowPx = Math.max(0, track.scrollHeight - viewport.clientHeight);
        if (overflowPx <= 1) {
          longestCycleMs = Math.max(longestCycleMs, HOLD_MS * 2);
          continue;
        }

        const moveMs = Math.max(7000, overflowPx * 28);
        const totalMs = HOLD_MS + moveMs + HOLD_MS + moveMs + HOLD_MS;
        longestCycleMs = Math.max(longestCycleMs, totalMs);

        const animation = track.animate(
          [
            { transform: "translateY(0px)", offset: 0 },
            { transform: "translateY(0px)", offset: HOLD_MS / totalMs },
            {
              transform: `translateY(${-overflowPx}px)`,
              offset: (HOLD_MS + moveMs) / totalMs,
            },
            {
              transform: `translateY(${-overflowPx}px)`,
              offset: (HOLD_MS + moveMs + HOLD_MS) / totalMs,
            },
            {
              transform: "translateY(0px)",
              offset: (HOLD_MS + moveMs + HOLD_MS + moveMs) / totalMs,
            },
            { transform: "translateY(0px)", offset: 1 },
          ],
          {
            duration: totalMs,
            easing: "linear",
            iterations: 1,
            fill: "both",
          },
        );
        animations.push(animation);
      }

      if (categoryPages.length > 1) {
        const dwellMs = Math.max(MIN_PAGE_DWELL_MS, longestCycleMs);
        const switchTimer = window.setTimeout(() => {
          setIsPageFading(true);
          const fadeTimer = window.setTimeout(() => {
            setPageIndex((prev) => (prev + 1) % categoryPages.length);
            setIsPageFading(false);
          }, PAGE_FADE_MS);
          cleanups.push(() => window.clearTimeout(fadeTimer));
        }, dwellMs);
        cleanups.push(() => window.clearTimeout(switchTimer));
      }
    });

    return () => {
      window.cancelAnimationFrame(raf);
      for (const animation of animations) {
        animation.cancel();
      }
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [activePage, categoryPages.length, pageIndex]);

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
                              <span>提供目安 {formatEta(menu.leadTimeSecondsP75_30m)}</span>
                            </div>
                          )}
                        </div>
                        <div className="menu-display-row-image-wrap">
                          {menu.coverImageDataUrl ? (
                            <img
                              src={menu.coverImageDataUrl}
                              alt={`${menu.name} の画像`}
                              className="menu-display-row-image"
                            />
                          ) : (
                            <div className="menu-display-row-image-placeholder">
                              NO IMAGE
                            </div>
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
