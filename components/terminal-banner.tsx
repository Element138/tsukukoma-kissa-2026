"use client";

import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";

type BannerProps = {
  actorLabel: string;
  actorType: string;
  actorId: string;
  offlineActors: Array<{ actorId: string; actorType: string }>;
  inactiveLineWarnings: Array<{ lineName: string }>;
};

export function TerminalBanner(props: BannerProps) {
  const router = useRouter();

  const doLogout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  return (
    <header className="terminal-banner">
      <div>
        <strong>{props.actorType}</strong>
        <span> / {props.actorId}</span>
        <span className="muted"> ({props.actorLabel})</span>
      </div>
      <div className="banner-statuses">
        {props.offlineActors.length > 0 ? (
          <span className="status warn">
            Offline: {props.offlineActors.map((a) => `${a.actorType}-${a.actorId}`).join(", ")}
          </span>
        ) : (
          <span className="status ok">All terminals online</span>
        )}

        {props.inactiveLineWarnings.length > 0 && (
          <span className="status error">
            Inactive line queued: {[...new Set(props.inactiveLineWarnings.map((w) => w.lineName))].join(", ")}
          </span>
        )}
      </div>
      <button className="ghost-btn" onClick={doLogout}>
        Logout
      </button>
    </header>
  );
}


