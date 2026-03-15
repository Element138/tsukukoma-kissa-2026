"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { ACTOR_TYPE_LABEL, SESSION_FAILURE_LABEL, labelOf } from "@/lib/labels";
import { routeByActorType } from "@/lib/routes";
import { useToast } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
      message: labelOf(
        SESSION_FAILURE_LABEL,
        logoutReason,
        "ログアウトしました",
      ),
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
      .catch((e) =>
        setError(
          e instanceof Error
            ? e.message
            : "ログイン用アカウントの取得に失敗しました",
        ),
      );
  }, []);

  const selectedActor = useMemo(
    () => actors.find((actor) => actor.id === selectedActorId) ?? null,
    [actors, selectedActorId],
  );
  const actorTypeChips = useMemo(
    () =>
      [...new Set(actors.map((actor) => actor.actorType))].map((actorType) =>
        labelOf(ACTOR_TYPE_LABEL, actorType),
      ),
    [actors],
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedActorId) {
      setError("アカウントを選択してください");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const data = await apiFetch<{ actorId: string; actorType: string }>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ actorId: selectedActorId, secret }),
        },
      );
      router.push(routeByActorType(data.actorType));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "ログインに失敗しました";
      setError(message);
      notify({ level: "error", message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-aura login-aura-one" aria-hidden />
      <div className="login-aura login-aura-two" aria-hidden />
      <div className="login-grid-overlay" aria-hidden />
      <section className="login-stage">
        <div className="login-hero">
          <p className="login-eyebrow">75期 喫茶</p>
          <h1 className="login-title">KISSaターミナル</h1>
          <div className="login-chip-row">
            {actorTypeChips.map((chip) => (
              <span key={chip} className="login-chip">
                {chip}
              </span>
            ))}
          </div>
        </div>

        <Card className="login-card">
          <div className="login-card-head">
            <p className="login-card-eyebrow">SIGN IN</p>
            <h2 className="login-card-title">ようこそ</h2>
            <p className="login-card-description">
              アカウントを選び、パスワードを入力してください。
            </p>
          </div>
          <form onSubmit={onSubmit} className="login-form">
            <label className="login-field">
              <span>アカウント</span>
              <Select
                value={selectedActorId}
                onValueChange={setSelectedActorId}
              >
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

            <label className="login-field">
              <span>パスワード</span>
              <Input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="パスワードを入力"
              />
            </label>

            <Button
              type="submit"
              disabled={busy || !selectedActorId}
              className="login-submit-btn"
            >
              {busy ? "ログイン中..." : "ログイン"}
            </Button>
          </form>
          {error && <div className="notice error">{error}</div>}
        </Card>
      </section>
      <span className="text-muted-foreground text-sm">© 2026 Sasuke Kondo</span>
    </main>
  );
}
