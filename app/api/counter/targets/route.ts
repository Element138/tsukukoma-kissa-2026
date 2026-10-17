import { NextRequest } from "next/server";
import { projectCounterItems, projectCounterStock, counterServingPlan } from "@/lib/domain/counter-availability";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["WAITER", "ADMIN"] });
    const data = await prisma.$transaction(async tx => {
      const stock = await tx.menuStock.findMany();
      const menus = await tx.menu.findMany({ select: { id: true, name: true, shortName: true, isActive: true }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }, { id: "asc" }] });
      const orders = await tx.order.findMany({
        where: { confirmedAt: { not: null }, orderStatus: { notIn: ["COMPLETED", "FAILED", "CANCELED"] }, items: { some: { status: "QUEUED" } } },
        include: { items: { orderBy: { id: "asc" } } }, orderBy: { orderNo: "asc" }
      });
      const readyByMenu = new Map(stock.map(s => [s.menuId, s.readyCount]));
      return { orders: orders.flatMap(order => {
        const { readyItems, servedItemGroups, unreadyItemGroups } = projectCounterItems(order.items, readyByMenu);
        return readyItems.length === 0 ? [] : [{ id: order.id, orderNo: order.orderNo, createdAt: order.createdAt, fulfillmentType: order.fulfillmentType, specialNote: order.specialNote, lastCalledAt: order.lastCalledAt, readyItems, servedItemGroups, unreadyItemGroups, itemCount: order.items.length, servingPlan: counterServingPlan(order.items, readyByMenu) }];
      }), stock: projectCounterStock(menus, stock, orders) };
    }, { isolationLevel: "RepeatableRead" });
    return ok(data);
  } catch (e) { return fail(e); }
}
