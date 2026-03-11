import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { assignmentUpsertSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/domain/audit";
import { updateMenusAvailabilityByKitchenCoverage } from "@/lib/domain/kitchen-assignment";
import { withRouteTrace, traceError } from "@/lib/server/trace";
import { AppError } from "@/lib/errors";
import { broadcastInvalidation, CHANNEL_GROUPS, kitchenChannel } from "@/lib/server/realtime-broadcast";

export async function GET(req: NextRequest) {
  return withRouteTrace(req, "admin/assignments.GET", async (trace) => {
    try {
      trace("auth.start");
      await requireSession(req, { actorTypes: ["ADMIN", "KITCHEN"] });
      trace("auth.ok");

      trace("db.findMany.start");
      const assignments = await prisma.menuKitchenAssignment.findMany({
        include: {
          menu: {
            select: {
              id: true,
              name: true
            }
          },
          kitchenActor: {
            select: {
              id: true,
              label: true,
              actorType: true,
              isActive: true,
              kitchenEnabled: true,
              kitchenDisplayOrder: true
            }
          }
        }
      });
      trace("db.findMany.ok", { count: assignments.length });

      return ok({ assignments });
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}

export async function POST(req: NextRequest) {
  return withRouteTrace(req, "admin/assignments.POST", async (trace) => {
    try {
      trace("auth.start");
      const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
      trace("auth.ok", { actorId: actor.actorId });

      trace("parseJson.start");
      const body = await parseJson(req, assignmentUpsertSchema);
      trace("parseJson.ok", { menuId: body.menuId, kitchenId: body.kitchenId, enabled: body.enabled });

      trace("tx.upsert.start");
      const assignment = await prisma.$transaction(async (tx) => {
        const kitchenActor = await tx.actor.findUnique({
          where: { id: body.kitchenId },
          select: { id: true, actorType: true }
        });
        if (!kitchenActor || kitchenActor.actorType !== "KITCHEN") {
          throw new AppError(400, "INVALID_KITCHEN_ACTOR", "kitchenId must reference a KITCHEN actor");
        }

        const saved = await tx.menuKitchenAssignment.upsert({
          where: {
            menuId_kitchenId: {
              menuId: body.menuId,
              kitchenId: body.kitchenId
            }
          },
          create: {
            menuId: body.menuId,
            kitchenId: body.kitchenId,
            enabled: body.enabled
          },
          update: {
            enabled: body.enabled
          }
        });

        await updateMenusAvailabilityByKitchenCoverage(tx, [body.menuId]);

        await writeAuditLog(tx, {
          actorId: actor.actorId,
          actorType: actor.actorType,
          actionType: "MENU_KITCHEN_ASSIGNMENT_UPSERT",
          entityType: "menu_kitchen_assignment",
          entityId: `${body.menuId}:${body.kitchenId}`,
          afterJson: saved,
          result: "SUCCESS"
        });

        await broadcastInvalidation(
          tx,
          [...CHANNEL_GROUPS.ASSIGNMENTS, kitchenChannel(body.kitchenId)],
          "assignments",
          "assignment_upserted"
        );

        return saved;
      });
      trace("tx.upsert.ok");

      return ok({ assignment });
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}
