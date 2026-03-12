"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { LogoPlaceholder } from "@/components/ui";
import { ACTOR_TYPE_LABEL, SESSION_FAILURE_LABEL, labelOf } from "@/lib/labels";
import { routeByActorType } from "@/lib/routes";
import { useToast } from "@/components/toast";

type LoginActor = {
  id: string;
  actorType: "POS" | "KITCHEN" | "WAITER" | "MENU_DISPLAY" | "ADMIN";
  label: string;
};

export default function LoginPage() {
  const router = useRouter();
  const { notify } = useToast();

  const [actors, setActors] = useState<LoginActor[]>([]);
  const [selectedActorId, setSelectedActorId] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logoutReason, setLogoutReason] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setLogoutReason(params.get("reason"));
  }, []);

  useEffect(() => {
    if (!logoutReason) {
      return;
    }

    notify({
      id: "login-reason",
      level: "warning",
      message: labelOf(SESSION_FAILURE_LABEL, logoutReason, "\u30ed\u30b0\u30a2\u30a6\u30c8\u3057\u307e\u3057\u305f")
    });
  }, [logoutReason, notify]);

  useEffect(() => {
    apiFetch<{ actors: LoginActor[] }>("/api/auth/login-options")
      .then((data) => {
        setActors(data.actors);
        if (data.actors.length > 0) {
          setSelectedActorId((prev) => prev || data.actors[0]!.id);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "\u30ed\u30b0\u30a4\u30f3\u7528\u30a2\u30ab\u30a6\u30f3\u30c8\u306e\u53d6\u5f97\u306b\u5931\u6557\u3057\u307e\u3057\u305f"));
  }, []);

  const selectedActor = useMemo(() => actors.find((actor) => actor.id === selectedActorId) ?? null, [actors, selectedActorId]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedActorId) {
      setError("\u30a2\u30ab\u30a6\u30f3\u30c8\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const data = await apiFetch<{ actorId: string; actorType: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ actorId: selectedActorId, secret })
      });
      router.push(routeByActorType(data.actorType));
    } catch (err) {
      const message = err instanceof Error ? err.message : "\u30ed\u30b0\u30a4\u30f3\u306b\u5931\u6557\u3057\u307e\u3057\u305f";
      setError(message);
      notify({ level: "error", message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <div className="center-box card">
        <div className="row between">
          <h1 style={{ margin: 0 }}>{"KISSa \u30ed\u30b0\u30a4\u30f3"}</h1>
          <LogoPlaceholder />
        </div>

        <form onSubmit={onSubmit} style={{ marginTop: 16 }} className="grid">
          <label>
            {"\u30a2\u30ab\u30a6\u30f3\u30c8"}
            <select value={selectedActorId} onChange={(e) => setSelectedActorId(e.target.value)}>
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {`${actor.label} (${labelOf(ACTOR_TYPE_LABEL, actor.actorType)})`}
                </option>
              ))}
            </select>
          </label>

          <label>
            {"\u30d1\u30b9\u30ef\u30fc\u30c9"}
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={selectedActor ? `${selectedActor.label} \u306e\u30d1\u30b9\u30ef\u30fc\u30c9` : "\u30d1\u30b9\u30ef\u30fc\u30c9"}
            />
          </label>

          <button disabled={busy || !selectedActorId}>
            {busy ? "\u30ed\u30b0\u30a4\u30f3\u4e2d..." : "\u30ed\u30b0\u30a4\u30f3"}
          </button>
        </form>

        {error && <div className="notice error">{error}</div>}
      </div>
    </main>
  );
}
