"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { LogoPlaceholder } from "@/components/logo-placeholder";
import { ACTOR_TYPE_LABEL, SESSION_FAILURE_LABEL, labelOf } from "@/lib/labels";
import { routeByActorType } from "@/lib/routes";
import { useToast } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
      message: labelOf(SESSION_FAILURE_LABEL, logoutReason, "ログアウトしました")
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
      .catch((e) => setError(e instanceof Error ? e.message : "ログイン用アカウントの取得に失敗しました"));
  }, []);

  const selectedActor = useMemo(() => actors.find((actor) => actor.id === selectedActorId) ?? null, [actors, selectedActorId]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedActorId) {
      setError("アカウントを選択してください");
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
      const message = err instanceof Error ? err.message : "ログインに失敗しました";
      setError(message);
      notify({ level: "error", message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <Card className="center-box card">
        <div className="row between">
          <div>
            <h1 style={{ margin: 0 }}>KISSa Login</h1>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Smart Cafe Operation Console
            </p>
          </div>
          <LogoPlaceholder />
        </div>

        <form onSubmit={onSubmit} style={{ marginTop: 16 }} className="grid">
          <label>
            アカウント
            <Select value={selectedActorId} onValueChange={setSelectedActorId}>
              <SelectTrigger className="bg-background text-foreground">
                <SelectValue placeholder="アカウントを選択" />
              </SelectTrigger>
              <SelectContent>
              {actors.map((actor) => (
                <SelectItem key={actor.id} value={actor.id}>
                  {`${actor.label} (${labelOf(ACTOR_TYPE_LABEL, actor.actorType)})`}
                </SelectItem>
              ))}
              </SelectContent>
            </Select>
          </label>

          <label>
            パスワード
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={selectedActor ? `${selectedActor.label} のパスワード` : "パスワード"}
            />
          </label>

          <Button type="submit" disabled={busy || !selectedActorId}>
            {busy ? "ログイン中..." : "ログイン"}
          </Button>
        </form>

        {error && <div className="notice error">{error}</div>}
      </Card>
    </main>
  );
}
