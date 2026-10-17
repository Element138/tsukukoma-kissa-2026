import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ORDER_DISPLAY", "ADMIN"] });
    const cursorText = req.nextUrl.searchParams.get("afterCallId");
    const afterCallId = cursorText != null && /^\d+$/.test(cursorText) ? Number(cursorText) : null;
    const data = await prisma.$transaction(async tx => {
      const orders = await tx.order.findMany({ where: { confirmedAt: { not: null }, orderStatus: { notIn: ["COMPLETED", "FAILED", "CANCELED"] } }, include: { items: true }, orderBy: { orderNo: "asc" } });
      const latest = await tx.orderCall.findFirst({ orderBy: { id: "desc" } });
      const cursor = latest?.id ?? 0;
      const calls = afterCallId == null ? [] : await tx.orderCall.findMany({ where: { id: { gt: afterCallId, lte: cursor }, order: { lastCalledAt: { not: null }, orderStatus: { notIn: ["COMPLETED", "FAILED", "CANCELED"] } } }, include: { order: { select: { id: true, orderNo: true, createdAt: true } } }, orderBy: { id: "asc" } });
      const history = calls.length === 0 ? [] : await tx.orderCall.findMany({ where: { orderId: { in: [...new Set(calls.map(c => c.orderId))] }, id: { lte: cursor } }, select: { id: true, orderId: true }, orderBy: { id: "asc" } });
      const countsByOrder = new Map<string, number>();
      const countsByCall = new Map<number, number>();
      for (const call of history) {
        const count = (countsByOrder.get(call.orderId) ?? 0) + 1;
        countsByOrder.set(call.orderId, count);
        countsByCall.set(call.id, count);
      }
      const rows = orders.map(order => ({ id: order.id, orderNo: order.orderNo, createdAt: order.createdAt, confirmedAt: order.confirmedAt, itemCount: order.items.length, readyItemCount: 0, queuedItemCount: order.items.filter(i => i.status === "QUEUED").length, lastCalledAt: order.lastCalledAt }));
      return { readyOrders: rows.filter(o => o.lastCalledAt), unreadyOrders: rows.filter(o => !o.lastCalledAt), callCursor: cursor, calls: calls.map(c => ({ id: c.order.id, orderNo: c.order.orderNo, createdAt: c.order.createdAt, callCount: countsByCall.get(c.id) ?? 1 })) };
    }, { isolationLevel: "RepeatableRead" });
    return ok(data);
  } catch (e) { return fail(e); }
}
