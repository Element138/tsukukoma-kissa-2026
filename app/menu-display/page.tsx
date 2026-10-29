"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { useToast } from "@/components/toast";
import { TerminalBanner } from "@/components/terminal-banner";
import { LoadingScreen } from "@/components/loading-screen";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { MenuDisplayView, type MenuDisplayPayload } from "@/components/menu-display-view";

const loadData = () => apiFetch<MenuDisplayPayload>("/api/menu-display");

export default function MenuDisplayPage() {
  const { loading, session } = useSession(["MENU_DISPLAY"]);
  const { notify, clearByPrefix } = useToast();
  const [revision, setRevision] = useState(0);
  useEffect(() => { clearByPrefix("admin-unsaved-warning"); }, [clearByPrefix]);
  useRealtimeSubscription({ enabled: Boolean(session), channels: ["menus", "categories", "orders", "settings"], onEvent: () => setRevision(value => value + 1), onResync: () => setRevision(value => value + 1) });
  if (loading || !session) return <LoadingScreen />;
  return <MenuDisplayView loadData={loadData} revision={revision}
    onError={message => notify({ level: "error", message })}
    terminalBanner={<TerminalBanner actorId={session.actor.actorId} actorType={session.actor.actorType} actorLabel={session.actor.label} offlineActors={session.offlineActors} />} />;
}
