import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { now } from "@/lib/time";
import { AppError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/domain/audit";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ incidentId: string }> }
) {
  try {
    const actor = await requireSession(req, { actorTypes: ["POS", "KITCHEN", "WAITER", "ADMIN"] });
    const { incidentId } = await context.params;

    const dismissed = await prisma.$transaction(async (tx) => {
      const incident = await tx.paymentIncident.findUnique({
        where: { id: incidentId },
        select: {
          id: true,
          orderId: true,
          dismissedAt: true
        }
      });
      if (!incident) {
        throw new AppError(404, "PAYMENT_INCIDENT_NOT_FOUND", "Payment incident not found");
      }
      if (incident.dismissedAt) {
        throw new AppError(409, "PAYMENT_INCIDENT_ALREADY_DISMISSED", "Payment incident already dismissed");
      }

      const updated = await tx.paymentIncident.update({
        where: { id: incidentId },
        data: {
          dismissedAt: now(),
          dismissedByActorId: actor.actorId
        },
        select: {
          id: true,
          orderId: true,
          dismissedAt: true
        }
      });

      await writeAuditLog(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        actionType: "PAYMENT_INCIDENT_DISMISSED",
        entityType: "payment_incident",
        entityId: updated.id,
        orderId: updated.orderId,
        result: "SUCCESS"
      });

      await broadcastInvalidation(tx, CHANNEL_GROUPS.ORDER_FLOW, "orders", "payment_incident_dismissed");
      return updated;
    });

    return ok({ incident: dismissed });
  } catch (error) {
    return fail(error);
  }
}
