import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { assignmentUpsertSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/domain/audit";
import { updateMenusAvailabilityByLineCoverage } from "@/lib/domain/line-assignment";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ADMIN", "KITCHEN"] });

    const assignments = await prisma.menuLineAssignment.findMany({
      include: {
        menu: {
          select: {
            id: true,
            name: true
          }
        },
        line: {
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
      const saved = await tx.menuLineAssignment.upsert({
        where: {
          menuId_lineId: {
            menuId: body.menuId,
            lineId: body.lineId
          }
        },
        create: {
          menuId: body.menuId,
          lineId: body.lineId,
          enabled: body.enabled
        },
        update: {
          enabled: body.enabled
        }
      });

      await updateMenusAvailabilityByLineCoverage(tx);
      return saved;
    });

    await writeAuditLog(prisma, {
      actorId: actor.actorId,
      actorType: actor.actorType,
      actionType: "MENU_LINE_ASSIGNMENT_UPSERT",
      entityType: "menu_line_assignment",
      entityId: `${body.menuId}:${body.lineId}`,
      afterJson: assignment,
      result: "SUCCESS"
    });

    return ok({ assignment });
  } catch (error) {
    return fail(error);
  }
}


