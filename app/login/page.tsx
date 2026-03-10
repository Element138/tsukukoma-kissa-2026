"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { LogoPlaceholder } from "@/components/ui";

function routeByActorType(actorType: string) {
  switch (actorType) {
    case "POS":
      return "/pos";
    case "KITCHEN":
      return "/kitchen";
    case "WAITER":
      return "/waiter";
    case "MENU_DISPLAY":
      return "/menu-display";
    case "ADMIN":
      return "/admin";
    default:
      return "/";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [actorId, setActorId] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const data = await apiFetch<{ actorId: string; actorType: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ actorId, secret })
      });
      router.push(routeByActorType(data.actorType));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <div className="center-box card">
        <div className="row between">
          <h1 style={{ margin: 0 }}>KISSa Login</h1>
          <LogoPlaceholder />
        </div>

        <form onSubmit={onSubmit} style={{ marginTop: 16 }} className="grid">
          <label>
            Actor ID
            <input value={actorId} onChange={(e) => setActorId(e.target.value)} placeholder="pos-main / kitchen-drink / admin" />
          </label>
          <label>
            Secret
            <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="PIN or passphrase" />
          </label>
          <button disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
        </form>

        {error && <div className="notice error">{error}</div>}

        <p className="muted" style={{ marginTop: 12 }}>
          10分無操作でタイムアウト。同一IDの新規ログイン時、旧セッションは自動ログアウトされます。
        </p>
      </div>
    </main>
  );
}


