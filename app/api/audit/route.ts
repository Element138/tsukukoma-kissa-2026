import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  actionType: z.string().optional(),
  actorType: z.string().optional(),
  actorId: z.string().optional(),
  result: z.string().optional(),
  orderNo: z.string().optional(),
  take: z.string().optional()
});

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ADMIN"] });

    const query = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));

    let orderId: string | undefined;
    if (query.orderNo) {
      const order = await prisma.order.findUnique({
        where: { orderNo: Number(query.orderNo) },
        select: { id: true }
      });
      orderId = order?.id;
      if (!orderId) {
        return ok({ logs: [] });
      }
    }

    const logs = await prisma.auditLog.findMany({
      where: {
        ...(query.from || query.to
          ? {
              timestamp: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {})
              }
            }
          : {}),
        ...(query.actionType ? { actionType: query.actionType } : {}),
        ...(query.actorType ? { actorType: query.actorType as any } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.result ? { result: query.result as any } : {}),
        ...(orderId ? { orderId } : {})
      },
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
      take: Math.min(Number(query.take ?? "500"), 1500)
    });

    const actorEntityIds = [...new Set(logs.filter((log) => log.entityType === "actor").map((log) => log.entityId))];
    const actorEntities =
      actorEntityIds.length === 0
        ? []
        : await prisma.actor.findMany({
            where: {
              id: {
                in: actorEntityIds
              }
            },
            select: {
              id: true,
              label: true
            }
          });
    const actorEntityMap = new Map(actorEntities.map((actor) => [actor.id, actor.label]));

    return ok({
      logs: logs.map((log) => ({
        ...log,
        actorLabel: log.actor?.label ?? null,
        entityLabel: log.entityType === "actor" ? actorEntityMap.get(log.entityId) ?? null : null
      }))
    });
  } catch (error) {
    return fail(error);
  }
}