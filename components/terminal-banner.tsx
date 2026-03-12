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
  offlinePrefix: "\u30aa\u30d5\u30e9\u30a4\u30f3\u7aef\u672b: ",
  quoteL: "\u300c",
  quoteR: "\u300d",
  sep: "\u3001",
  inactivePrefix: "\u505c\u6b62\u4e2d\u30ad\u30c3\u30c1\u30f3\u306b\u6ede\u7559: ",
  statusOffline: "\u7aef\u672b\u306e\u30aa\u30d5\u30e9\u30a4\u30f3\u3092\u691c\u77e5",
  statusOnline: "\u7aef\u672b\u306f\u3059\u3079\u3066\u30aa\u30f3\u30e9\u30a4\u30f3",
  statusInactiveKitchen: "\u505c\u6b62\u4e2d\u30ad\u30c3\u30c1\u30f3\u306b\u672a\u51e6\u7406\u3042\u308a",
  logout: "\u30ed\u30b0\u30a2\u30a6\u30c8"
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