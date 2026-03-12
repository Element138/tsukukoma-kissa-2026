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
  inactiveKitchenWarnings: Array<{ kitchenName: string }>;
};

const JP = {
  offlinePrefix: "オフライン端末: ",
  quoteL: "「",
  quoteR: "」",
  sep: "、",
  inactivePrefix: "停止中キッチンに滞留: ",
  statusOffline: "端末のオフラインを検知",
  statusOnline: "端末はすべてオンライン",
  statusInactiveKitchen: "停止中キッチンに未処理あり",
  logout: "ログアウト"
};

export function TerminalBanner(props: BannerProps) {
  const router = useRouter();
  const { notify, dismiss } = useToast();

  const doLogout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.push("/login?reason=LOGOUT_MANUAL");
  };

  useEffect(() => {
    if (props.offlineActors.length > 0) {
      notify({
        id: "critical-offline",
        level: "warning",
        sticky: true,
        message: `${JP.offlinePrefix}${props.offlineActors
          .map((actor) => `${labelOf(ACTOR_TYPE_LABEL, actor.actorType)}${JP.quoteL}${actor.label}${JP.quoteR}`)
          .join(JP.sep)}`
      });
    } else {
      dismiss("critical-offline");
    }
  }, [props.offlineActors, notify, dismiss]);

  useEffect(() => {
    if (props.inactiveKitchenWarnings.length > 0) {
      notify({
        id: "critical-kitchen",
        level: "error",
        sticky: true,
        message: `${JP.inactivePrefix}${[...new Set(props.inactiveKitchenWarnings.map((w) => w.kitchenName))].join(JP.sep)}`
      });
    } else {
      dismiss("critical-kitchen");
    }
  }, [props.inactiveKitchenWarnings, notify, dismiss]);

  return (
    <header className="terminal-banner">
      <div>
        <strong>{labelOf(ACTOR_TYPE_LABEL, props.actorType)}</strong>
        <span className="muted"> / {props.actorLabel}</span>
      </div>
      <div className="banner-statuses">
        {props.offlineActors.length > 0 ? (
          <span className="status warn">{JP.statusOffline}</span>
        ) : (
          <span className="status ok">{JP.statusOnline}</span>
        )}

        {props.inactiveKitchenWarnings.length > 0 && <span className="status error">{JP.statusInactiveKitchen}</span>}
      </div>
      <button className="ghost-btn" onClick={doLogout}>
        {JP.logout}
      </button>
    </header>
  );
}