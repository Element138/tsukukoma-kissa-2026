import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { parseAgeRangesToCounts } from "@/lib/age-groups";

type TimelineEvent = {
  id: string;
  at: Date;
  title: string;
  detail: string | null;
  actorLabel: string | null;
  tone: "info" | "success" | "warning" | "danger";
};

function parseEvents(raw: Prisma.JsonValue | null) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return null;
      }
      const record = row as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type : "";
      const atValue = typeof record.at === "string" ? record.at : "";
      const at = new Date(atValue);
      if (!type || Number.isNaN(at.getTime())) {
        return null;
      }
      const detail =
        record.detail && typeof record.detail === "object" && !Array.isArray(record.detail)
          ? (record.detail as Record<string, unknown>)
          : null;
      const actorId = typeof record.actorId === "string" ? record.actorId : null;
      return { index, type, at, detail, actorId };
    })
    .filter((event): event is NonNullable<typeof event> => Boolean(event));
}

function secondsBetween(from: Date | null, to: Date | null) {
  if (!from || !to) {
    return null;
  }
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}

function eventTitle(type: string) {
  switch (type) {
    case "PAYMENT_STARTED":
      return "決済開始";
    case "PAYMENT_SUCCESS":
      return "決済成功";
    case "PAYMENT_FAILED":
      return "決済失敗";
    case "ORDER_CONFIRMED":
      return "注文確定";
    case "ORDER_FAILED":
      return "注文失敗";
    case "SPECIAL_NOTE_UPDATED":
      return "備考更新";
    case "PAYMENT_SUCCESS_CALLBACK_AFTER_FAILED":
      return "失敗後の決済成功通知";
    default:
      return type;
  }
}

function auditTitle(actionType: string) {
  switch (actionType) {
    case "PAYMENT_START":
      return "注文作成";
    case "ORDER_CONFIRMED":
      return "注文確定";
    case "PAYMENT_FAILED":
      return "決済失敗";
    case "ORDER_FAILED":
      return "注文失敗";
    case "ITEM_READY":
      return "調理済み";
    case "ITEM_READY_BATCH":
      return "まとめて調理済み";
    case "ITEM_SERVED":
      return "提供済み";
    case "ORDER_SERVED":
      return "注文提供済み";
    case "UNDO":
      return "取り消し";
    case "SPECIAL_NOTE_UPDATED":
      return "備考更新";
    default:
      return actionType;
  }
}

function toneFor(title: string): TimelineEvent["tone"] {
  if (title.includes("失敗") || title.includes("異常")) {
    return "danger";
  }
  if (title.includes("取り消し") || title.includes("更新")) {
    return "warning";
  }
  if (title.includes("成功") || title.includes("確定") || title.includes("提供")) {
    return "success";
  }
  return "info";
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    await requireSession(req, {
      actorTypes: ["POS", "KITCHEN", "WAITER", "ADMIN"],
    });
    const { orderId } = await context.params;

    const order = await prisma.order.findUnique({
      where: {
        id: orderId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            label: true,
            actorType: true,
          },
        },
        items: {
          include: {
            kitchenActor: {
              select: {
                id: true,
                label: true,
              },
            },
          },
          orderBy: {
            itemNameSnapshot: "asc",
          },
        },
        auditLogs: {
          include: {
            actor: {
              select: {
                label: true,
              },
            },
          },
          orderBy: {
            timestamp: "asc",
          },
          take: 200,
        },
        paymentIncidents: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!order) {
      return ok({ order: null }, { status: 404 });
    }

    const actorIds = [
      ...new Set(parseEvents(order.events).map((event) => event.actorId).filter(Boolean)),
    ] as string[];
    const eventActors =
      actorIds.length === 0
        ? []
        : await prisma.actor.findMany({
            where: {
              id: {
                in: actorIds,
              },
            },
            select: {
              id: true,
              label: true,
            },
          });
    const actorLabelById = new Map(eventActors.map((actor) => [actor.id, actor.label]));

    const readyTimes = order.items
      .map((item) => item.readyAt)
      .filter((readyAt): readyAt is Date => Boolean(readyAt));
    const servedTimes = order.items
      .map((item) => item.servedAt)
      .filter((servedAt): servedAt is Date => Boolean(servedAt));
    const allReadyAt =
      readyTimes.length > 0
        ? new Date(Math.max(...readyTimes.map((readyAt) => readyAt.getTime())))
        : null;
    const completedAt =
      servedTimes.length > 0
        ? new Date(Math.max(...servedTimes.map((servedAt) => servedAt.getTime())))
        : null;

    const timeline: TimelineEvent[] = [
      {
        id: "created",
        at: order.createdAt,
        title: "注文作成",
        detail: `担当: ${order.createdBy.label}`,
        actorLabel: order.createdBy.label,
        tone: "info",
      } satisfies TimelineEvent,
      ...parseEvents(order.events).map((event) => {
        const title = eventTitle(event.type);
        const reasonText =
          typeof event.detail?.reasonText === "string" ? event.detail.reasonText : null;
        const squareTransactionId =
          typeof event.detail?.squareTransactionId === "string"
            ? event.detail.squareTransactionId
            : null;
        return {
          id: `event-${event.index}`,
          at: event.at,
          title,
          detail: reasonText ?? squareTransactionId ?? null,
          actorLabel: event.actorId ? actorLabelById.get(event.actorId) ?? event.actorId : null,
          tone: toneFor(title),
        } satisfies TimelineEvent;
      }),
      ...order.items.flatMap((item) => {
        const rows: TimelineEvent[] = [];
        if (item.readyAt) {
          rows.push({
            id: `item-ready-${item.id}`,
            at: item.readyAt,
            title: "調理済み",
            detail: item.itemNameSnapshot,
            actorLabel: item.kitchenActor?.label ?? null,
            tone: "success",
          });
        }
        if (item.servedAt) {
          rows.push({
            id: `item-served-${item.id}`,
            at: item.servedAt,
            title: "提供済み",
            detail: item.itemNameSnapshot,
            actorLabel: null,
            tone: "success",
          });
        }
        return rows;
      }),
      ...order.paymentIncidents.map((incident) => ({
        id: `incident-${incident.id}`,
        at: incident.createdAt,
        title: "決済異常",
        detail: incident.messageJa,
        actorLabel: null,
        tone: "danger" as const,
      })),
      ...order.auditLogs.map((log) => {
        const title = auditTitle(log.actionType);
        return {
          id: `audit-${log.id}`,
          at: log.timestamp,
          title,
          detail: log.reasonText ?? log.reasonType ?? null,
          actorLabel: log.actor?.label ?? log.actorId ?? null,
          tone: toneFor(title),
        } satisfies TimelineEvent;
      }),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    return ok({
      order: {
        id: order.id,
        orderNo: order.orderNo,
        createdAt: order.createdAt,
        confirmedAt: order.confirmedAt,
        completedAt,
        fulfillmentType: order.fulfillmentType,
        tableNo: order.tableNo,
        partySize: order.partySize,
        ageGroupCounts: parseAgeRangesToCounts(order.ageRangesJson),
        specialNote: order.specialNote,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        totalPriceJpy: order.totalPriceJpy,
        createdBy: order.createdBy,
        durations: {
          createdToConfirmedSeconds: secondsBetween(order.createdAt, order.confirmedAt),
          confirmedToReadySeconds: secondsBetween(order.confirmedAt, allReadyAt),
          readyToServedSeconds: secondsBetween(allReadyAt, completedAt),
          confirmedToServedSeconds: secondsBetween(order.confirmedAt, completedAt),
        },
        items: order.items.map((item) => ({
          id: item.id,
          menuId: item.menuId,
          name: item.itemNameSnapshot,
          unitPriceJpy: item.unitPriceJpy,
          status: item.status,
          kitchenId: item.kitchenId,
          kitchenLabel: item.kitchenActor?.label ?? null,
          readyAt: item.readyAt,
          servedAt: item.servedAt,
          productionSeconds: secondsBetween(order.confirmedAt, item.readyAt),
          handoffSeconds: secondsBetween(item.readyAt, item.servedAt),
          customerWaitSeconds: secondsBetween(order.confirmedAt, item.servedAt),
        })),
        timeline,
      },
    });
  } catch (error) {
    return fail(error);
  }
}
