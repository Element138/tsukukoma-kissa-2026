"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { ACTOR_TYPE_LABEL, AUDIT_RESULT_LABEL, labelOf } from "@/lib/labels";
import { useToast } from "@/components/toast";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AuditLog = {
  id: string;
  timestamp: string;
  actorId: string | null;
  actorLabel: string | null;
  actorType: string | null;
  actionType: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  orderId: string | null;
  result: "SUCCESS" | "FAILURE";
  reasonType: string | null;
  reasonText: string | null;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
};

function toText(value: unknown) {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

function diffSummary(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  const b = before ?? {};
  const a = after ?? {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const changed = keys.filter(
    (key) => JSON.stringify(b[key]) !== JSON.stringify(a[key]),
  );

  if (changed.length === 0) {
    return "変更なし";
  }

  return changed
    .slice(0, 6)
    .map((key) => `${key}: ${toText(b[key])} -> ${toText(a[key])}`)
    .join(" / ");
}

function formatEntity(log: AuditLog) {
  const label = log.entityLabel?.trim();
  if (!label) {
    return `${log.entityType}:${log.entityId}`;
  }
  if (label === log.entityId) {
    return `${log.entityType}:${label}`;
  }
  return `${log.entityType}:${label} (${log.entityId})`;
}

export default function AuditPage() {
  const { loading, session } = useSession(["ADMIN"]);
  const { notify } = useToast();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [actionType, setActionType] = useState("");
  const [actorType, setActorType] = useState("");
  const [result, setResult] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const actorTypeSelectValue = actorType || "__ALL_ACTOR_TYPE__";
  const resultSelectValue = result || "__ALL_RESULT__";

  const reload = async () => {
    try {
      const params = new URLSearchParams();
      if (actionType) params.set("actionType", actionType);
      if (actorType) params.set("actorType", actorType);
      if (result) params.set("result", result);
      if (orderNo) params.set("orderNo", orderNo);
      const data = await apiFetch<{ logs: AuditLog[] }>(
        `/api/audit?${params.toString()}`,
      );
      setLogs(data.logs);
    } catch (e) {
      notify({
        level: "error",
        message:
          e instanceof Error ? e.message : "監査ログの取得に失敗しました",
      });
    }
  };

  useEffect(() => {
    if (!session) return;
    void reload();
  }, [session, actionType, actorType, result, orderNo]);

  useRealtimeSubscription({
    enabled: Boolean(session),
    channels: ["audit"],
    onEvent: () => {
      void reload();
    },
    onResync: () => {
      void reload();
    },
  });

  const rows = useMemo(
    () =>
      logs.map((log) => ({
        ...log,
        diff: diffSummary(log.beforeJson, log.afterJson),
      })),
    [logs],
  );

  if (loading || !session) {
    return <LoadingScreen />;
  }

  return (
    <>
      <TerminalBanner
        actorId={session.actor.actorId}
        actorType={session.actor.actorType}
        actorLabel={session.actor.label}
        offlineActors={session.offlineActors}
      />
      <DashboardShell
        eyebrow="AUDIT LOG"
        title="監査ログ"
        // subtitle="操作履歴と変更要約を即時確認"
      >
        <div>
          <div className="row between wrap" style={{ marginBottom: 12 }}>
            {/* <h1 style={{ margin: 0 }}>監査ログ</h1> */}
            <div className="row wrap">
              <a href="/api/audit/export" className="btn-link ghost-btn">
                CSV出力
              </a>
              <Link href="/admin" className="btn-link ghost-btn">
                管理画面へ戻る
              </Link>
            </div>
          </div>

          <div className="card row wrap" style={{ marginBottom: 12 }}>
            <Input
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              placeholder="アクション"
              style={{ maxWidth: 220 }}
            />
            <div style={{ maxWidth: 180, width: "100%" }}>
              <Select
                value={actorTypeSelectValue}
                onValueChange={(v) =>
                  setActorType(v === "__ALL_ACTOR_TYPE__" ? "" : v)
                }
              >
                <SelectTrigger className="bg-background text-foreground">
                  <SelectValue placeholder="ロール: すべて" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL_ACTOR_TYPE__">
                    ロール: すべて
                  </SelectItem>
                  <SelectItem value="POS">POS</SelectItem>
                  <SelectItem value="KITCHEN">キッチン</SelectItem>
                  <SelectItem value="WAITER">配膳</SelectItem>
                  <SelectItem value="ADMIN">管理</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div style={{ maxWidth: 170, width: "100%" }}>
              <Select
                value={resultSelectValue}
                onValueChange={(v) =>
                  setResult(v === "__ALL_RESULT__" ? "" : v)
                }
              >
                <SelectTrigger className="bg-background text-foreground">
                  <SelectValue placeholder="結果: すべて" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL_RESULT__">結果: すべて</SelectItem>
                  <SelectItem value="SUCCESS">成功</SelectItem>
                  <SelectItem value="FAILURE">失敗</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
              placeholder="注文番号"
              style={{ maxWidth: 120 }}
            />
          </div>

          <div className="card table-scroll">
            <table className="table audit-table">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>アクション</th>
                  <th>ロール</th>
                  <th>対象</th>
                  <th>結果</th>
                  <th>変更要約</th>
                  <th>理由</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((log) => (
                  <tr key={log.id}>
                    <td>
                      {new Date(log.timestamp).toLocaleString("ja-JP", {
                        timeZone: "Asia/Tokyo",
                      })}
                    </td>
                    <td>{log.actionType}</td>
                    <td>
                      {labelOf(ACTOR_TYPE_LABEL, log.actorType)} /{" "}
                      {log.actorLabel ?? "-"}
                    </td>
                    <td className="audit-entity-cell">{formatEntity(log)}</td>
                    <td>{labelOf(AUDIT_RESULT_LABEL, log.result)}</td>
                    <td className="audit-wrap-cell">{log.diff}</td>
                    <td className="audit-reason-cell">
                      {log.reasonType ?? log.reasonText ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DashboardShell>
    </>
  );
}
