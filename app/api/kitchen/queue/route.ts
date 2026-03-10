import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { elapsedMss } from "@/lib/time";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN", "ADMIN"] });
    const lineId = actor.actorType === "KITCHEN" ? actor.lineId : req.nextUrl.searchParams.get("lineId");
    if (!lineId) {
      return ok({ items: [] });
    }

    const items = await prisma.orderItem.findMany({
      where: {
        lineId,
        status: "QUEUED",
        order: {
          confirmedAt: { not: null },
          orderStatus: { notIn: ["COMPLETED", "CANCELED"] }
        }
      },
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            confirmedAt: true,
            fulfillmentType: true,
            tableNo: true,
            specialNote: true
          }
        },
        line: {
          select: {
            id: true,
            name: true,
            isActive: true
          }
        }
      },
      orderBy: [
        { order: { confirmedAt: "asc" } },
        { lineAssignedAt: "asc" }
      ]
    });

    const grouped = items.map((item) => ({
      id: item.id,
      name: item.itemNameSnapshot,
      orderId: item.order.id,
      orderNo: item.order.orderNo,
      fulfillmentType: item.order.fulfillmentType,
      tableNo: item.order.tableNo,
      specialNote: item.order.specialNote,
      elapsed: item.order.confirmedAt ? elapsedMss(item.order.confirmedAt) : "0:00",
      lineName: item.line?.name ?? "Unknown",
      lineInactiveWarning: item.line ? !item.line.isActive : true
    }));

    return ok({ items: grouped });
  } catch (error) {
    return fail(error);
  }
}


