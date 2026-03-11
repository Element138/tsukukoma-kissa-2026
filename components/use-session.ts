"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, isAuthError } from "@/lib/client";

type SessionPayload = {
  actor: {
    actorId: string;
    actorType: "POS" | "KITCHEN" | "WAITER" | "MENU_DISPLAY" | "ADMIN";
    lineId: string | null;
    label: string;
  };
  offlineActors: Array<{ actorId: string; actorType: string }>;
  inactiveLineQueuedItems: Array<{ orderId: string; orderItemId: string; lineName: string }>;
};

export function useSession(requiredTypes?: Array<SessionPayload["actor"]["actorType"]>) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requiredKey = useMemo(() => (requiredTypes ? requiredTypes.join(",") : ""), [requiredTypes]);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const data = await apiFetch<SessionPayload>("/api/auth/me");
        if (!alive) {
          return;
        }

        if (requiredTypes && !requiredTypes.includes(data.actor.actorType)) {
          router.replace("/");
          return;
        }

        setSession(data);
        setError(null);
      } catch (e) {
        if (!alive) {
          return;
        }

        const msg = e instanceof Error ? e.message : "Session error";
        setError(msg);

        // Only auth failures should force logout navigation.
        if (isAuthError(e)) {
          setSession(null);
          router.replace("/login");
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    load();
    const timer = setInterval(load, 15000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [router, requiredKey]);

  return { loading, session, error };
}
