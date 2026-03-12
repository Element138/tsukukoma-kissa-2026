"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { ACTOR_TYPE_LABEL, labelOf } from "@/lib/labels";
import { useToast } from "@/components/toast";

type BannerProps = {
  actorLabel: string;
  actorType: string;
  actorId: string;
  offlineActors: Array<{ actorId: string; actorType: string; label: string }>;
};

const JP = {
  offlinePrefix: "オフライン端末: ",
  quoteL: "「",
  quoteR: "」",
  sep: "、",
  statusOffline: "オフライン端末があります",
  statusOnline: "全端末オンライン",
  logout: "ログアウト"
};

export function TerminalBanner(props: BannerProps) {
  const router = useRouter();
  const { notify, dismiss } = useToast();

  const doLogout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.push("/login?reason=LOGOUT_MANUAL");
  };

  const showOfflineToast = () => {
    if (props.offlineActors.length === 0) {
      return;
    }

    notify({
      id: "critical-offline",
      level: "warning",
      sticky: true,
      message: `${JP.offlinePrefix}${props.offlineActors
        .map((actor) => `${labelOf(ACTOR_TYPE_LABEL, actor.actorType)}${JP.quoteL}${actor.label}${JP.quoteR}`)
        .join(JP.sep)}`
    });
  };

  useEffect(() => {
    if (props.offlineActors.length === 0) {
      dismiss("critical-offline");
    }
  }, [props.offlineActors, dismiss]);

  return (
    <header className="terminal-banner">
      <div>
        <strong>{labelOf(ACTOR_TYPE_LABEL, props.actorType)}</strong>
        <span className="muted"> / {props.actorLabel}</span>
      </div>
      <div className="banner-statuses">
        {props.offlineActors.length > 0 ? (
          <button type="button" className="status warn banner-status-btn" onClick={showOfflineToast}>
            {JP.statusOffline}
          </button>
        ) : (
          <span className="status ok">{JP.statusOnline}</span>
        )}
      </div>
      <button className="ghost-btn" type="button" onClick={doLogout}>
        {JP.logout}
      </button>
    </header>
  );
}
