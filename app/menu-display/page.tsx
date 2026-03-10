"use client";

import { useEffect, useState } from "react";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";

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

  const reload = async () => {
    try {
      const data = await apiFetch<{ categories: DisplayCategory[] }>("/api/menu-display");
      setCategories(data.categories);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込み失敗");
    }
  };

  useEffect(() => {
    if (!session) {
      return;
    }
    reload();
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, [session]);

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
        inactiveLineWarnings={session.inactiveLineQueuedItems.map((x) => ({ lineName: x.lineName }))}
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
                        ? `目安 ${Math.ceil(menu.leadTimeSecondsMedian30m / 60)} 分`
                        : "目安: 統計不足"}
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


