"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";

type AuditLog = {
  id: string;
  timestamp: string;
  actorId: string | null;
  actorType: string | null;
  actionType: string;
  entityType: string;
  entityId: string;
  orderId: string | null;
  result: "SUCCESS" | "FAILURE";
  reasonType: string | null;
  reasonText: string | null;
};

export default function AuditPage() {
  const { loading, session } = useSession(["ADMIN"]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [actionType, setActionType] = useState("");
  const [actorType, setActorType] = useState("");
  const [result, setResult] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const params = new URLSearchParams();
      if (actionType) params.set("actionType", actionType);
      if (actorType) params.set("actorType", actorType);
      if (result) params.set("result", result);
      if (orderNo) params.set("orderNo", orderNo);
      const data = await apiFetch<{ logs: AuditLog[] }>(`/api/audit?${params.toString()}`);
      setLogs(data.logs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "audit load failed");
    }
  };

  useEffect(() => {
    if (!session) return;
    reload();
  }, [session, actionType, actorType, result, orderNo]);

  if (loading || !session) {
    return <main>Loading...</main>;
  }

  return (
    <>
      <TerminalBanner
        actorId={session.actor.actorId}
        actorType={session.actor.actorType}
        actorLabel={session.actor.label}
        offlineActors={session.offlineActors}
        inactiveKitchenWarnings={session.inactiveKitchenQueuedItems.map((x) => ({ kitchenName: x.kitchenName }))}
      />
      <main>
        <div className="row between wrap" style={{ marginBottom: 12 }}>
          <h1 style={{ margin: 0 }}>Audit Log</h1>
          <div className="row wrap">
            <a href="/api/audit/export">
              <button className="ghost-btn">CSV Export</button>
            </a>
            <Link href="/admin">
              <button className="ghost-btn">Back to Admin</button>
            </Link>
          </div>
        </div>

        <div className="card row wrap" style={{ marginBottom: 12 }}>
          <input value={actionType} onChange={(e) => setActionType(e.target.value)} placeholder="actionType" style={{ maxWidth: 220 }} />
          <select value={actorType} onChange={(e) => setActorType(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">actorType: all</option>
            <option value="POS">POS</option>
            <option value="KITCHEN">KITCHEN</option>
            <option value="WAITER">WAITER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <select value={result} onChange={(e) => setResult(e.target.value)} style={{ maxWidth: 170 }}>
            <option value="">result: all</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="FAILURE">FAILURE</option>
          </select>
          <input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="orderNo" style={{ maxWidth: 120 }} />
        </div>

        {error && <div className="notice error">{error}</div>}

        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Entity</th>
                <th>Result</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{new Date(log.timestamp).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</td>
                  <td>{log.actionType}</td>
                  <td>
                    {log.actorType ?? "-"} / {log.actorId ?? "-"}
                  </td>
                  <td>
                    {log.entityType}:{log.entityId}
                  </td>
                  <td>{log.result}</td>
                  <td>{log.reasonType ?? log.reasonText ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}


