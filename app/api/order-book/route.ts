import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { triggerPaymentWatchdogBestEffort } from "@/lib/server/payment-watchdog-trigger";
import { parseAgeRangesToCounts } from "@/lib/age-groups";
import { getMenuCapStates } from "@/lib/domain/menu-cap";

const querySchema = z.object({
  orderNo: z.string().optional(),
  menuId: z.string().uuid().optional(),
  minItems: z.string().optional(),
  maxItems: z.string().optional(),
  minTotal: z.string().optional(),
  maxTotal: z.string().optional(),
  paymentMethod: z.string().optional(),
  fulfillmentType: z.string().optional(),
  status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.enum(["new", "old"]).optional()
});

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["POS", "KITCHEN", "WAITER", "ADMIN"] });
    triggerPaymentWatchdogBestEffort();

    const query = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));

    const orders = await prisma.order.findMany({
      where: {
        ...(query.orderNo ? { orderNo: Number(query.orderNo) } : {}),
        ...(query.paymentMethod ? { paymentMethod: query.paymentMethod as any } : {}),
        ...(query.fulfillmentType ? { fulfillmentType: query.fulfillmentType as any } : {}),
        ...(query.status ? { orderStatus: query.status as any } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {})
              }
            }
          : {})
      },
      include: {
        items: {
          include: {
            kitchenActor: {
              select: {
                id: true,
                label: true
              }
            }
          }
        }
      },
      take: 500,
      orderBy: {
        createdAt: query.sort === "old" ? "asc" : "desc"
      }
    });

    const filtered = orders.filter((order) => {
      const count = order.items.length;
      if (query.minItems && count < Number(query.minItems)) {
        return false;
      }
      if (query.maxItems && count > Number(query.maxItems)) {
        return false;
      }
      if (query.minTotal && order.totalPriceJpy < Number(query.minTotal)) {
        return false;
      }
      if (query.maxTotal && order.totalPriceJpy > Number(query.maxTotal)) {
        return false;
      }
      if (query.menuId && !order.items.some((item) => item.menuId === query.menuId)) {
        return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const aOpen = a.orderStatus !== "COMPLETED" && a.orderStatus !== "FAILED" && a.orderStatus !== "CANCELED";
      const bOpen = b.orderStatus !== "COMPLETED" && b.orderStatus !== "FAILED" && b.orderStatus !== "CANCELED";
      if (aOpen !== bOpen) {
        return aOpen ? -1 : 1;
      }
      if (query.sort === "old") {
        return a.createdAt.getTime() - b.createdAt.getTime();
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    const rows = filtered.map((order) => {
      const servedTimestamps = order.items
        .map((item) => item.servedAt)
        .filter((servedAt): servedAt is Date => Boolean(servedAt));

      const completedAt = servedTimestamps.length > 0
        ? new Date(Math.max(...servedTimestamps.map((servedAt) => servedAt.getTime())))
        : null;

      return {
        id: order.id,
        orderNo: order.orderNo,
        createdAt: order.createdAt,
        confirmedAt: order.confirmedAt,
        completedAt,
        fulfillmentType: order.fulfillmentType,
        tableNo: order.tableNo,
        partySize: order.partySize,
        ageGroupCounts: parseAgeRangesToCounts(order.ageRangesJson),
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        totalPriceJpy: order.totalPriceJpy,
        specialNote: order.specialNote,
        items: order.items.map((item) => ({
          id: item.id,
          menuId: item.menuId,
          name: item.itemNameSnapshot,
          status: item.status,
          kitchenId: item.kitchenId,
          kitchenName: item.kitchenActor?.label ?? item.kitchenActor?.id
        }))
      };
    });

    const menuCountsMap = new Map<
      string,
      {
        menuId: string;
        name: string;
        ordered: number;
        queued: number;
      }
    >();

    for (const order of rows) {
      if (order.orderStatus === "FAILED" || order.orderStatus === "CANCELED") {
        continue;
      }

      for (const item of order.items) {
        const key = item.menuId;
        const existing = menuCountsMap.get(key) ?? {
          menuId: item.menuId,
          name: item.name,
          ordered: 0,
          queued: 0,
        };

        if (item.status === "QUEUED") {
          existing.ordered += 1;
          existing.queued += 1;
        } else if (item.status === "READY") {
          existing.ordered += 1;
        } else if (item.status === "SERVED") {
          existing.ordered += 1;
        }
        menuCountsMap.set(key, existing);
      }
    }

    const countedMenuIds = [...menuCountsMap.keys()];
    const countedMenus = await prisma.menu.findMany({
      where: {
        id: { in: countedMenuIds },
      },
      select: {
        id: true,
        name: true,
        dailyOrderCap: true,
      },
    });
    const countedMenuById = new Map(countedMenus.map((menu) => [menu.id, menu]));
    const capStateByMenuId = await getMenuCapStates(
      prisma,
      countedMenus.map((menu) => ({
        menuId: menu.id,
        dailyOrderCap: menu.dailyOrderCap ?? null,
      })),
    );

    const menuCounts = [...menuCountsMap.values()]
      .map((row) => {
        const menu = countedMenuById.get(row.menuId);
        const capState = capStateByMenuId.get(row.menuId);
        return {
          menuId: row.menuId,
          name: menu?.name ?? row.name,
          ordered: capState?.todayCount ?? 0,
          queued: row.queued,
          cap: capState?.dailyOrderCap ?? null,
          toCap: capState?.remainingUntilCap ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));

    const incidents = await prisma.paymentIncident.findMany({
      where: {
        dismissedAt: null
      },
      select: {
        id: true,
        orderId: true,
        messageJa: true,
        createdAt: true,
        order: {
          select: {
            orderNo: true,
            createdByActorId: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 50
    });

    return ok({
      orders: rows,
      menuCounts,
      incidents: incidents.map((incident) => ({
        id: incident.id,
        orderId: incident.orderId,
        orderNo: incident.order.orderNo,
        responsiblePosActorId: incident.order.createdByActorId,
        messageJa: incident.messageJa,
        createdAt: incident.createdAt
      }))
    });
  } catch (error) {
    return fail(error);
  }
}
