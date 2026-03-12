import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail } from "@/lib/response";

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ADMIN"] });

    const logs = await prisma.auditLog.findMany({
      include: {
        actor: {
          select: {
            label: true
          }
        }
      },
      orderBy: {
        timestamp: "desc"
      },
      take: 5000
    });

    const header = [
      "timestamp",
      "actor_id",
      "actor_label",
      "actor_type",
      "action_type",
      "entity_type",
      "entity_id",
      "order_id",
      "result",
      "reason_type",
      "reason_text",
      "before_json",
      "after_json",
      "correlation_id"
    ].join(",");

    const body = [
      header,
      ...logs.map((log) =>
        [
          log.timestamp.toISOString(),
          log.actorId ?? "",
          log.actor?.label ?? "",
          log.actorType ?? "",
          log.actionType,
          log.entityType,
          log.entityId,
          log.orderId ?? "",
          log.result,
          log.reasonType ?? "",
          log.reasonText ?? "",
          JSON.stringify(log.beforeJson ?? null),
          JSON.stringify(log.afterJson ?? null),
          log.correlationId ?? ""
        ]
          .map(csvEscape)
          .join(",")
      )
    ].join("\n");

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit_log_${Date.now()}.csv"`
      }
    });
  } catch (error) {
    return fail(error);
  }
}