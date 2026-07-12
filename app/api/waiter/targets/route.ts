import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["WAITER", "ADMIN"] });

    const dineInOrdersRaw = await prisma.order.findMany({
      where: {
        fulfillmentType: "DINE_IN",
        orderStatus: { notIn: ["COMPLETED", "FAILED", "CANCELED"] },
        items: {
          some: {
            status: "READY"
          }
        }
      },
      select: {
        id: true,
        orderNo: true,
        createdAt: true,
        specialNote: true,
        items: {
          where: {
            status: "READY"
          },
          select: {
            id: true,
            itemNameSnapshot: true
          },
          orderBy: [{ id: "asc" }]
        }
      },
      orderBy: [{ orderNo: "asc" }]
    });

    const takeoutOrdersRaw = await prisma.order.findMany({
      where: {
        fulfillmentType: "TAKEOUT",
        orderStatus: {
          in: ["AWAITING_SERVING", "PREPARING"]
        },
        items: {
          every: {
            status: {
              in: ["READY", "SERVED"]
            }
          },
          some: {
            status: "READY"
          }
        }
      },
      select: {
        id: true,
        orderNo: true,
        createdAt: true,
        totalPriceJpy: true,
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

    const takeoutOrders = takeoutOrdersRaw.map((order) => ({
      id: order.id,
      orderNo: order.orderNo,
      createdAt: order.createdAt,
      totalPriceJpy: order.totalPriceJpy,
      itemCount: order.items.length,
      itemNames: order.items.map((i) => i.itemNameSnapshot),
      readyItemCount: order.items.filter((i) => i.status === "READY").length
    }));

    return ok({
      dineInOrders: dineInOrdersRaw.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        createdAt: order.createdAt,
        specialNote: order.specialNote,
        readyItems: order.items.map((item) => ({
          id: item.id,
          name: item.itemNameSnapshot
        })),
        readyItemCount: order.items.length
      })),
      takeoutOrders
    });
  } catch (error) {
    return fail(error);
  }
}
