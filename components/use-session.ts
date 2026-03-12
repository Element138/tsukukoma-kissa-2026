"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch, isAuthError } from "@/lib/client";

type SessionPayload = {
  actor: {
    actorId: string;
    actorType: "POS" | "KITCHEN" | "WAITER" | "MENU_DISPLAY" | "ADMIN";
    label: string;
  };
  offlineActors: Array<{ actorId: string; actorType: string; label: string }>;
  inactiveKitchenQueuedItems: Array<{ orderId: string; orderItemId: string; kitchenName: string }>;
};

function toReasonCode(error: unknown): string {
  if (error instanceof ApiError && error.code) {
    return error.code;
  }
  return "UNAUTHORIZED";
}

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
          router.replace(`/login?reason=FORBIDDEN`);
          return;
        }

        setSession(data);
        setError(null);
      } catch (e) {
        if (!alive) {
          return;
        }

        const msg = e instanceof Error ? e.message : "\u30bb\u30c3\u30b7\u30e7\u30f3\u30a8\u30e9\u30fc";
        setError(msg);

        if (isAuthError(e)) {
          setSession(null);
          const reason = encodeURIComponent(toReasonCode(e));
          router.replace(`/login?reason=${reason}`);
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    void load();
    const timer = setInterval(load, 15000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [router, requiredKey]);

  return { loading, session, error };
}
