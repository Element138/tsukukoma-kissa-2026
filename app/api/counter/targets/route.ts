import { NextRequest } from "next/server";
import { projectCounterItems, projectCounterStock, counterServingPlan } from "@/lib/domain/counter-availability";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { resetExpiredReadyStock } from "@/lib/domain/daily-ready-stock";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["WAITER", "ADMIN"] });
    const data = await prisma.$transaction(async tx => {
      await resetExpiredReadyStock(tx);
      const stock = await tx.menuStock.findMany();
      const menus = await tx.menu.findMany({ select: { id: true, name: true, shortName: true, isActive: true }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }, { id: "asc" }] });
      const orders = await tx.order.findMany({
        where: { confirmedAt: { not: null }, orderStatus: { notIn: ["COMPLETED", "FAILED", "CANCELED"] }, items: { some: { status: { in: ["QUEUED", "GHOSTED"] } } } },
        include: { items: { orderBy: { id: "asc" } } }, orderBy: { orderNo: "asc" }
      });
      const readyByMenu = new Map(stock.map(s => [s.menuId, s.readyCount]));
      const projected = orders.flatMap(order => {
        const { readyItems, servedItemGroups, unreadyItemGroups } = projectCounterItems(order.items, readyByMenu);
        return readyItems.length === 0 && !order.ghostedAt ? [] : [{ id: order.id, orderNo: order.orderNo, createdAt: order.createdAt, ghostedAt: order.ghostedAt, fulfillmentType: order.fulfillmentType, specialNote: order.specialNote, lastCalledAt: order.lastCalledAt, readyItems, servedItemGroups, unreadyItemGroups, itemCount: order.items.length, servingPlan: counterServingPlan(order.items, readyByMenu) }];
      });
      return { orders: projected.filter(order => !order.ghostedAt), ghostOrders: projected.filter(order => order.ghostedAt), stock: projectCounterStock(menus, stock, orders.filter(order => !order.ghostedAt)) };
    }, { isolationLevel: "RepeatableRead" });
    return ok(data);
  } catch (e) { return fail(e); }
}
