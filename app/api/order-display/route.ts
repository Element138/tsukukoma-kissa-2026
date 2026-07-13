import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";

function isReadyOrder(
  items: Array<{ status: string; readyAt: Date | null }>,
  readyCutoff: Date,
) {
  const readyItems = items.filter((item) => item.status === "READY");
  if (readyItems.length === 0) {
    return false;
  }

  const allReadyOrServed = items.every(
    (item) => item.status === "READY" || item.status === "SERVED",
  );
  const hasAgedReadyItem = readyItems.some(
    (item) => item.readyAt != null && item.readyAt <= readyCutoff,
  );

  return allReadyOrServed || hasAgedReadyItem;
}

function isUnreadyOrder(items: Array<{ status: string }>) {
  return items.some((item) => item.status === "QUEUED");
}

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ORDER_DISPLAY", "ADMIN"] });

    const [orders, setting] = await Promise.all([
      prisma.order.findMany({
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
            readyAt: true,
          },
        },
      },
      orderBy: [{ orderNo: "asc" }],
      take: 200,
      }),
      prisma.appSetting.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          menuDisplayPageSeconds: 18,
          counterReadyGraceMinutes: 3,
          orderDisplayMarqueeText: "",
          orderDisplayMarqueeSpeedSeconds: 24,
        },
        update: {},
      }),
    ]);
    const readyCutoff = new Date(
      Date.now() - setting.counterReadyGraceMinutes * 60 * 1000,
    );

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

    const rawById = new Map(orders.map((order) => [order.id, order]));
    const readyOrders = rows.filter((order) =>
      isReadyOrder(rawById.get(order.id)?.items ?? [], readyCutoff),
    );
    const readyOrderIds = new Set(readyOrders.map((order) => order.id));

    return ok({
      unreadyOrders: rows.filter(
        (order) =>
          !readyOrderIds.has(order.id) &&
          isUnreadyOrder(rawById.get(order.id)?.items ?? []),
      ),
      readyOrders,
    });
  } catch (error) {
    return fail(error);
  }
}
