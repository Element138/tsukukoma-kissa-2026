"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";

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
  const [categories, setCategories] = useState<DisplayCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reloadInFlightRef = useRef(false);

  const reload = async () => {
    if (reloadInFlightRef.current) {
      return;
    }
    reloadInFlightRef.current = true;

    try {
      const data = await apiFetch<{ categories: DisplayCategory[] }>("/api/menu-display");
      setCategories(data.categories);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load menu display");
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
    return <main>Loading...</main>;
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
        <h1 style={{ marginTop: 0 }}>Menu Display</h1>
        {error && <div className="notice error">{error}</div>}

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
                        ? `Lead time ${Math.ceil(menu.leadTimeSecondsMedian30m / 60)} min`
                        : "Lead time unavailable"}
                    </div>
                    <div>
                      {menu.availability === "AVAILABLE" && <span className="badge ready">AVAILABLE</span>}
                      {menu.availability === "PAUSED" && <span className="badge queued">PAUSED</span>}
                      {menu.availability === "SOLD_OUT" && <span className="badge served">SOLD OUT</span>}
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
