import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { elapsedMss } from "@/lib/time";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN", "ADMIN"] });
    const kitchenId = actor.actorType === "KITCHEN" ? actor.actorId : req.nextUrl.searchParams.get("kitchenId");
    if (!kitchenId) {
      return ok({ items: [] });
    }

    const items = await prisma.orderItem.findMany({
      where: {
        kitchenId,
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
        kitchenActor: {
          select: {
            id: true,
            label: true,
            actorType: true,
            isActive: true,
            kitchenEnabled: true
          }
        }
      },
      orderBy: [{ order: { confirmedAt: "asc" } }, { kitchenAssignedAt: "asc" }]
    });

    const grouped = items.map((item) => {
      const inactive = !item.kitchenActor || item.kitchenActor.actorType !== "KITCHEN" || !item.kitchenActor.isActive || !item.kitchenActor.kitchenEnabled;
      return {
        id: item.id,
        name: item.itemNameSnapshot,
        orderId: item.order.id,
        orderNo: item.order.orderNo,
        fulfillmentType: item.order.fulfillmentType,
        tableNo: item.order.tableNo,
        specialNote: item.order.specialNote,
        elapsed: item.order.confirmedAt ? elapsedMss(item.order.confirmedAt) : "0:00",
        kitchenName: item.kitchenActor?.label ?? item.kitchenActor?.id ?? "Unknown",
        kitchenInactiveWarning: inactive
      };
    });

    return ok({ items: grouped });
  } catch (error) {
    return fail(error);
  }
}
