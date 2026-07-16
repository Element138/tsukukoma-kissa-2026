import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { AppError } from "@/lib/errors";
import { parseAgeRangesToCounts } from "@/lib/age-groups";

type RouteContext = { params: Promise<{ orderId: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    await requireSession(req, {
      actorTypes: ["POS", "KITCHEN", "WAITER", "ADMIN"],
    });
    const { orderId } = await context.params;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        createdBy: { select: { id: true, label: true } },
        items: {
          include: {
            kitchenActor: { select: { id: true, label: true } },
            servedBy: { select: { id: true, label: true } },
          },
          orderBy: [{ itemNameSnapshot: "asc" }, { id: "asc" }],
        },
        auditLogs: {
          include: { actor: { select: { id: true, label: true } } },
          orderBy: [{ timestamp: "asc" }, { id: "asc" }],
        },
        paymentIncidents: {
          include: {
            dismissedBy: { select: { id: true, label: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!order) {
      throw new AppError(404, "ORDER_NOT_FOUND", "注文が見つかりません");
    }

    const rawEvents = Array.isArray(order.events) ? order.events : [];
    const eventActorIds = rawEvents
      .map((event) =>
        event && typeof event === "object" && !Array.isArray(event)
          ? (event as Record<string, unknown>).actorId
          : null,
      )
      .filter((value): value is string => typeof value === "string");
    const eventActors =
      eventActorIds.length === 0
        ? []
        : await prisma.actor.findMany({
            where: { id: { in: [...new Set(eventActorIds)] } },
            select: { id: true, label: true },
          });

    return ok({
      order: {
        ...order,
        ageGroupCounts: parseAgeRangesToCounts(order.ageRangesJson),
        eventActors: Object.fromEntries(
          eventActors.map((actor) => [actor.id, actor.label]),
        ),
      },
    });
  } catch (error) {
    return fail(error);
  }
}
