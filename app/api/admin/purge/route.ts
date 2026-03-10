import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { writeAuditLog } from "@/lib/domain/audit";
import { AppError } from "@/lib/errors";

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
      const result = await prisma.auditLog.deleteMany({});
      await writeAuditLog(prisma, {
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
      return ok({ deleted: result.count, target: body.target });
    }

    const deletedItems = await prisma.orderItem.deleteMany({});
    const deletedOrders = await prisma.order.deleteMany({});

    await writeAuditLog(prisma, {
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

    return ok({
      target: body.target,
      deletedOrders: deletedOrders.count,
      deletedItems: deletedItems.count
    });
  } catch (error) {
    return fail(error);
  }
}


