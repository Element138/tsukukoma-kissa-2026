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
          every: {
            status: {
              in: ["READY", "SERVED"],
            },
          },
          some: {
            status: "READY",
          },
        },
      },
      select: {
        id: true,
        orderNo: true,
        createdAt: true,
        specialNote: true,
        items: {
          select: {
            id: true,
            status: true,
            itemNameSnapshot: true,
          },
          orderBy: [{ id: "asc" }],
        },
      },
      orderBy: [{ orderNo: "asc" }],
    });

    const takeoutOrdersRaw = await prisma.order.findMany({
      where: {
        fulfillmentType: "TAKEOUT",
        orderStatus: {
          in: ["AWAITING_SERVING", "PREPARING"],
        },
        items: {
          every: {
            status: {
              in: ["READY", "SERVED"],
            },
          },
          some: {
            status: "READY",
          },
        },
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
            itemNameSnapshot: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const takeoutOrders = takeoutOrdersRaw.map((order) => ({
      id: order.id,
      orderNo: order.orderNo,
      createdAt: order.createdAt,
      totalPriceJpy: order.totalPriceJpy,
      itemCount: order.items.length,
      itemNames: order.items.map((i) => i.itemNameSnapshot),
      readyItemCount: order.items.filter((i) => i.status === "READY").length,
    }));

    return ok({
      dineInOrders: dineInOrdersRaw.map((order) => {
        const readyItems = order.items.filter((item) => item.status === "READY");

        return {
          id: order.id,
          orderNo: order.orderNo,
          createdAt: order.createdAt,
          specialNote: order.specialNote,
          readyItems: readyItems.map((item) => ({
            id: item.id,
            name: item.itemNameSnapshot,
          })),
          readyItemCount: readyItems.length,
          itemCount: order.items.length,
        };
      }),
      takeoutOrders,
    });
  } catch (error) {
    return fail(error);
  }
}
