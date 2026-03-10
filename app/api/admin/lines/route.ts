import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { lineCreateSchema, lineUpdateSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/domain/audit";
import { toggleLineState } from "@/lib/domain/kitchen";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ADMIN", "KITCHEN"] });

    const lines = await prisma.line.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }]
    });

    return ok({ lines });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
    const body = await parseJson(req, lineCreateSchema);

    const line = await prisma.line.create({
      data: body
    });

    await writeAuditLog(prisma, {
      actorId: actor.actorId,
      actorType: actor.actorType,
      actionType: "LINE_CREATED",
      entityType: "line",
      entityId: line.id,
      afterJson: line,
      result: "SUCCESS"
    });

    return ok({ line });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
    const body = await parseJson(req, lineUpdateSchema);

    let line;
    if (typeof body.isActive === "boolean") {
      line = await prisma.$transaction((tx) =>
        toggleLineState(tx, {
          actorId: actor.actorId,
          actorType: actor.actorType,
          lineId: body.id,
          isActive: body.isActive as boolean
        })
      );

      if (body.name || typeof body.displayOrder === "number") {
        line = await prisma.line.update({
          where: { id: body.id },
          data: {
            name: body.name,
            displayOrder: body.displayOrder
          }
        });
      }
    } else {
      line = await prisma.line.update({
        where: { id: body.id },
        data: {
          name: body.name,
          displayOrder: body.displayOrder
        }
      });

      await writeAuditLog(prisma, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        actionType: "LINE_UPDATED",
        entityType: "line",
        entityId: body.id,
        afterJson: line,
        result: "SUCCESS"
      });
    }

    return ok({ line });
  } catch (error) {
    return fail(error);
  }
}


