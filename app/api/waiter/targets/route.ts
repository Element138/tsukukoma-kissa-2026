import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["WAITER", "ADMIN"] });

    const dineInItems = await prisma.orderItem.findMany({
      where: {
        status: "READY",
        order: {
          fulfillmentType: "DINE_IN",
          orderStatus: { notIn: ["COMPLETED", "CANCELED"] }
        }
      },
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            tableNo: true,
            specialNote: true
          }
        }
      },
      orderBy: [{ readyAt: "asc" }, { order: { tableNo: "asc" } }]
    });

    const takeoutOrdersRaw = await prisma.order.findMany({
      where: {
        fulfillmentType: "TAKEOUT",
        orderStatus: {
          in: ["AWAITING_SERVING", "PREPARING"]
        }
      },
      include: {
        items: {
          select: {
            id: true,
            status: true,
            itemNameSnapshot: true
          }
        }
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    const takeoutOrders = takeoutOrdersRaw
      .filter((order) => {
        const allReadyOrServed = order.items.every((i) => i.status === "READY" || i.status === "SERVED");
        const hasReady = order.items.some((i) => i.status === "READY");
        return allReadyOrServed && hasReady;
      })
      .map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        totalPriceJpy: order.totalPriceJpy,
        itemCount: order.items.length,
        itemNames: order.items.map((i) => i.itemNameSnapshot)
      }));

    return ok({
      dineInItems: dineInItems.map((i) => ({
        id: i.id,
        name: i.itemNameSnapshot,
        orderId: i.orderId,
        orderNo: i.order.orderNo,
        tableNo: i.order.tableNo,
        readyAt: i.readyAt,
        specialNote: i.order.specialNote
      })),
      takeoutOrders
    });
  } catch (error) {
    return fail(error);
  }
}


