import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";

function isDineInCounterReady(
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

function bundleItems(items: Array<{ itemNameSnapshot: string }>) {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(
      item.itemNameSnapshot,
      (counts.get(item.itemNameSnapshot) ?? 0) + 1,
    );
  }

  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "ja"))
    .map(([name, count]) => ({ name, count }));
}

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["WAITER", "ADMIN"] });

    const setting = await prisma.appSetting.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        menuDisplayPageSeconds: 18,
        counterReadyGraceMinutes: 3,
      },
      update: {},
    });
    const readyCutoff = new Date(
      Date.now() - setting.counterReadyGraceMinutes * 60 * 1000,
    );

    const dineInOrdersRaw = await prisma.order.findMany({
      where: {
        fulfillmentType: "DINE_IN",
        orderStatus: { notIn: ["COMPLETED", "FAILED", "CANCELED"] },
        items: {
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
            readyAt: true,
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
            readyAt: true,
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
      dineInOrders: dineInOrdersRaw.filter((order) =>
        isDineInCounterReady(order.items, readyCutoff),
      ).map((order) => {
        const readyItems = order.items.filter((item) => item.status === "READY");
        const servedItems = order.items.filter(
          (item) => item.status === "SERVED",
        );
        const unreadyItems = order.items.filter(
          (item) => item.status === "QUEUED",
        );

        return {
          id: order.id,
          orderNo: order.orderNo,
          createdAt: order.createdAt,
          specialNote: order.specialNote,
          readyItems: readyItems.map((item) => ({
            id: item.id,
            name: item.itemNameSnapshot,
          })),
          servedItemGroups: bundleItems(servedItems),
          unreadyItemGroups: bundleItems(unreadyItems),
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
