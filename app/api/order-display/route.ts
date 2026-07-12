import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";

function isReadyOrder(items: Array<{ status: string }>) {
  return (
    items.length > 0 &&
    items.some((item) => item.status === "READY") &&
    items.every((item) => item.status === "READY" || item.status === "SERVED")
  );
}

function isUnreadyOrder(items: Array<{ status: string }>) {
  return items.some((item) => item.status === "QUEUED");
}

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ORDER_DISPLAY", "ADMIN"] });

    const orders = await prisma.order.findMany({
      where: {
        fulfillmentType: "DINE_IN",
        confirmedAt: { not: null },
        orderStatus: { notIn: ["COMPLETED", "FAILED", "CANCELED"] },
      },
      select: {
        id: true,
        orderNo: true,
        createdAt: true,
        confirmedAt: true,
        items: {
          select: {
            status: true,
          },
        },
      },
      orderBy: [{ orderNo: "asc" }],
      take: 200,
    });

    const rows = orders.map((order) => {
      const queuedItemCount = order.items.filter(
        (item) => item.status === "QUEUED",
      ).length;
      const readyItemCount = order.items.filter(
        (item) => item.status === "READY",
      ).length;

      return {
        id: order.id,
        orderNo: order.orderNo,
        createdAt: order.createdAt,
        confirmedAt: order.confirmedAt,
        itemCount: order.items.length,
        readyItemCount,
        queuedItemCount,
      };
    });

    return ok({
      unreadyOrders: rows.filter((order) =>
        isUnreadyOrder(
          orders.find((raw) => raw.id === order.id)?.items ?? [],
        ),
      ),
      readyOrders: rows.filter((order) =>
        isReadyOrder(orders.find((raw) => raw.id === order.id)?.items ?? []),
      ),
    });
  } catch (error) {
    return fail(error);
  }
}
