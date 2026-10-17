import { NextRequest } from "next/server";
import { projectCounterItems, counterServingPlan } from "@/lib/domain/counter-availability";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["WAITER", "ADMIN"] });
    const data = await prisma.$transaction(async tx => {
      const stock = await tx.menuStock.findMany({ where: { readyCount: { gt: 0 } }, include: { menu: { select: { name: true } } }, orderBy: { menuId: "asc" } });
      const orders = await tx.order.findMany({
        where: { confirmedAt: { not: null }, orderStatus: { notIn: ["COMPLETED", "FAILED", "CANCELED"] }, items: { some: { status: "QUEUED", menuId: { in: stock.map(s => s.menuId) } } } },
        include: { items: { orderBy: { id: "asc" } } }, orderBy: { orderNo: "asc" }
      });
      return { orders: orders.map(order => {
        const { readyItems, servedItemGroups, unreadyItemGroups } = projectCounterItems(order.items, new Map(stock.map(s => [s.menuId, s.readyCount])));
        return { id: order.id, orderNo: order.orderNo, createdAt: order.createdAt, fulfillmentType: order.fulfillmentType, specialNote: order.specialNote, lastCalledAt: order.lastCalledAt, readyItems, servedItemGroups, unreadyItemGroups, itemCount: order.items.length, servingPlan: counterServingPlan(order.items, new Map(stock.map(s => [s.menuId, s.readyCount]))) };
      }), stock: stock.map(s => ({ menuId: s.menuId, name: s.menu.name, count: s.readyCount })) };
    }, { isolationLevel: "RepeatableRead" });
    return ok(data);
  } catch (e) { return fail(e); }
}
