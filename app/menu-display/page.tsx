"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
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
    leadTimeSecondsMedian30m: number | null;
  }>;
};

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <TerminalBanner
        actorId={session.actor.actorId}
        actorType={session.actor.actorType}
        actorLabel={session.actor.label}
        offlineActors={session.offlineActors}
        inactiveKitchenWarnings={session.inactiveKitchenQueuedItems.map((x) => ({ kitchenName: x.kitchenName }))}
      />
      <main>
        <h1 style={{ marginTop: 0 }}>メニュー表示</h1>

        <div className="grid">
          {categories.map((category) => (
            <section key={category.id} className="card">
              <h2 style={{ marginTop: 0 }}>{category.name}</h2>
              <div className="menu-tile-grid">
                {category.menus.map((menu) => (
                  <article key={menu.id} className="menu-tile">
                    <strong>{menu.name}</strong>
                    <div>{fmtJpy(menu.priceJpy)}</div>
                    <div className="muted">
                      {menu.leadTimeSecondsMedian30m != null
                        ? `目安 ${Math.ceil(menu.leadTimeSecondsMedian30m / 60)} 分`
                        : "目安データなし"}
                    </div>
                    <div>
                      <span className={`badge availability-${menu.availability.toLowerCase()}`}>{labelOf(AVAILABILITY_LABEL, menu.availability)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}