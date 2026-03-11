import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { kitchenCreateSchema, kitchenUpdateSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/domain/audit";
import { toggleKitchenState } from "@/lib/domain/kitchen";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ADMIN", "KITCHEN"] });

    const kitchens = await prisma.kitchen.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }]
    });

    return ok({ kitchens });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
    const body = await parseJson(req, kitchenCreateSchema);

    const kitchen = await prisma.kitchen.create({
      data: body
    });

    await writeAuditLog(prisma, {
      actorId: actor.actorId,
      actorType: actor.actorType,
      actionType: "KITCHEN_CREATED",
      entityType: "kitchen",
      entityId: kitchen.id,
      afterJson: kitchen,
      result: "SUCCESS"
    });

    return ok({ kitchen });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
    const body = await parseJson(req, kitchenUpdateSchema);

    let kitchen;
    if (typeof body.isActive === "boolean") {
      kitchen = await prisma.$transaction((tx) =>
        toggleKitchenState(tx, {
          actorId: actor.actorId,
          actorType: actor.actorType,
          kitchenId: body.id,
          isActive: body.isActive as boolean
        })
      );

      if (body.name || typeof body.displayOrder === "number") {
        kitchen = await prisma.kitchen.update({
          where: { id: body.id },
          data: {
            name: body.name,
            displayOrder: body.displayOrder
          }
        });
      }
    } else {
      kitchen = await prisma.kitchen.update({
        where: { id: body.id },
        data: {
          name: body.name,
          displayOrder: body.displayOrder
        }
      });

      await writeAuditLog(prisma, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        actionType: "KITCHEN_UPDATED",
        entityType: "kitchen",
        entityId: body.id,
        afterJson: kitchen,
        result: "SUCCESS"
      });
    }

    return ok({ kitchen });
  } catch (error) {
    return fail(error);
  }
}


