import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { writeAuditLog } from "@/lib/domain/audit";
import { AppError } from "@/lib/errors";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

const schema = z.object({
  target: z.enum(["ORDERS", "AUDIT_LOGS"]),
  confirmationText: z.string().min(1)
});

export async function POST(req: NextRequest) {
  try {
    const admin = await requireSession(req, { actorTypes: ["ADMIN"] });
    const body = await parseJson(req, schema);

    if (body.confirmationText !== "DELETE") {
      throw new AppError(400, "CONFIRMATION_REQUIRED", "confirmationText must be DELETE");
    }

    if (body.target === "AUDIT_LOGS") {
      const data = await prisma.$transaction(async (tx) => {
        const result = await tx.auditLog.deleteMany({});

        await writeAuditLog(tx, {
          actorId: admin.actorId,
          actorType: admin.actorType,
          actionType: "AUDIT_LOGS_PURGED",
          entityType: "audit_log",
          entityId: "*",
          afterJson: {
            count: result.count
          },
          result: "SUCCESS"
        });

        await broadcastInvalidation(tx, CHANNEL_GROUPS.AUDIT, "audit", "audit_logs_purged");
        return result;
      });

      return ok({ deleted: data.count, target: body.target });
    }

    const data = await prisma.$transaction(async (tx) => {
      await tx.menuStock.deleteMany({});
      await tx.undoOperation.deleteMany({});
      const deletedItems = await tx.orderItem.deleteMany({});
      const deletedOrders = await tx.order.deleteMany({});
      await tx.$executeRaw`ALTER SEQUENCE "Order_orderNo_seq" RESTART WITH 1`;

      await writeAuditLog(tx, {
        actorId: admin.actorId,
        actorType: admin.actorType,
        actionType: "ORDERS_PURGED",
        entityType: "order",
        entityId: "*",
        afterJson: {
          orders: deletedOrders.count,
          items: deletedItems.count
        },
        result: "SUCCESS"
      });

      await broadcastInvalidation(tx, CHANNEL_GROUPS.ORDER_FLOW, "orders", "orders_purged");
      return { deletedItems, deletedOrders };
    });

    return ok({
      target: body.target,
      deletedOrders: data.deletedOrders.count,
      deletedItems: data.deletedItems.count
    });
  } catch (error) {
    return fail(error);
  }
}
