"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
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
  const reloadInFlightRef = useRef(false);

  const reload = async () => {
    if (reloadInFlightRef.current) {
      return;
    }
    reloadInFlightRef.current = true;

    try {
      const data = await apiFetch<{ categories: DisplayCategory[] }>("/api/menu-display");
      setCategories(data.categories);
    } catch (e) {
      notify({ level: "error", message: e instanceof Error ? e.message : "メニュー表示の取得に失敗しました" });
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
    channels: ["menus", "categories", "orders"],
    onEvent: () => {
      void reload();
    },
    onResync: () => {
      void reload();
    }
  });

  if (loading || !session) {
    return <main>読み込み中...</main>;
  }

  return (
    <>
      <TerminalBanner actorId={session.actor.actorId} actorType={session.actor.actorType} actorLabel={session.actor.label} offlineActors={session.offlineActors} />
      <DashboardShell
        eyebrow="LIVE MENU BOARD"
        title="メニュー表示"
        subtitle="提供状況と目安時間をリアルタイム表示"
      >
        <div>
        <div className="grid">
          {categories.map((category) => (
            <section key={category.id} className="card">
              <h2 style={{ marginTop: 0 }}>{category.name}</h2>
              <div className="menu-tile-grid">
                {category.menus.map((menu) => {
                  const unavailable = menu.availability !== "AVAILABLE";
                  return (
                    <article key={menu.id} className={`menu-tile ${unavailable ? "unavailable" : ""}`}>
                      <strong>{menu.name}</strong>

                      {unavailable ? (
                        <div className="menu-tile-status">{labelOf(AVAILABILITY_LABEL, menu.availability)}</div>
                      ) : (
                        <div className="menu-tile-footer">
                          <div className="menu-tile-stat">{fmtJpy(menu.priceJpy)}</div>
                          <div style={{ textAlign: "right" }}>
                            <div className="muted" style={{ fontSize: "0.75rem" }}>
                              提供目安 (75%)
                            </div>
                            <div className="menu-tile-stat">{formatEta(menu.leadTimeSecondsP75_30m)}</div>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        </div>
      </DashboardShell>
    </>
  );
}

