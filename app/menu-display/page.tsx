"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { AVAILABILITY_LABEL, labelOf } from "@/lib/labels";
import { useToast } from "@/components/toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DisplayCategory = {
  id: string;
  name: string;
  menus: Array<{
    id: string;
    name: string;
    priceJpy: number;
    availability: "AVAILABLE" | "PAUSED" | "SOLD_OUT";
    leadTimeSecondsP75_30m: number | null;
  }>;
};

function formatEta(seconds: number | null) {
  if (seconds == null) {
    return "-- 分";
  }
  return `${Math.max(1, Math.ceil(seconds / 60))} 分`;
}

export default function MenuDisplayPage() {
  const { loading, session } = useSession(["MENU_DISPLAY"]);
  const { notify } = useToast();

  const [categories, setCategories] = useState<DisplayCategory[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const reloadInFlightRef = useRef(false);

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
    return <main>読み込み中...</main>;
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
        subtitle={isFullscreen ? "全画面表示中" : "提供状況と目安時間をリアルタイム表示"}
        fancyHeader={!isFullscreen}
        className={isFullscreen ? "menu-display-fullscreen" : "menu-display-standard"}
        actions={
          <button type="button" className="ghost-btn" onClick={toggleFullscreen}>
            {isFullscreen ? "全画面を終了" : "全画面表示"}
          </button>
        }
      >
        <div className="grid menu-display-page">
          {categories.map((category) => (
            <Card key={category.id} className="card">
              <CardHeader className="p-0 pb-3">
                <CardTitle className="text-xl font-black">
                  {category.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="menu-tile-grid">
                  {category.menus.map((menu) => {
                    const unavailable = menu.availability !== "AVAILABLE";
                    return (
                      <article
                        key={menu.id}
                        className={`menu-tile ${unavailable ? "unavailable" : ""}`}
                      >
                        <strong>{menu.name}</strong>

                        {unavailable ? (
                          <div className="menu-tile-status">
                            {labelOf(AVAILABILITY_LABEL, menu.availability)}
                          </div>
                        ) : (
                          <div className="menu-tile-footer">
                            <div className="menu-tile-stat">
                              {fmtJpy(menu.priceJpy)}
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div
                                className="muted"
                                style={{ fontSize: "0.75rem" }}
                              >
                                提供目安
                              </div>
                              <div className="menu-tile-stat">
                                {formatEta(menu.leadTimeSecondsP75_30m)}
                              </div>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </DashboardShell>
    </>
  );
}
