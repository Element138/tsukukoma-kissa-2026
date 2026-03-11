import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { assignmentUpsertSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/domain/audit";
import { updateMenusAvailabilityByKitchenCoverage } from "@/lib/domain/kitchen-assignment";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ADMIN", "KITCHEN"] });

    const assignments = await prisma.menuKitchenAssignment.findMany({
      include: {
        menu: {
          select: {
            id: true,
            name: true
          }
        },
        kitchen: {
          select: {
            id: true,
            name: true,
            isActive: true
          }
        }
      }
    });

    return ok({ assignments });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
    const body = await parseJson(req, assignmentUpsertSchema);

    const assignment = await prisma.$transaction(async (tx) => {
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

      await updateMenusAvailabilityByKitchenCoverage(tx);
      return saved;
    });

    await writeAuditLog(prisma, {
      actorId: actor.actorId,
      actorType: actor.actorType,
      actionType: "MENU_KITCHEN_ASSIGNMENT_UPSERT",
      entityType: "menu_kitchen_assignment",
      entityId: `${body.menuId}:${body.kitchenId}`,
      afterJson: assignment,
      result: "SUCCESS"
    });

    return ok({ assignment });
  } catch (error) {
    return fail(error);
  }
}


