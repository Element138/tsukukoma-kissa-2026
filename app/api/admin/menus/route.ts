import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { menuCreateSchema, menuUpdateSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/domain/audit";
import { AppError } from "@/lib/errors";

async function hasActiveCoverage(menuId: string) {
  const count = await prisma.menuLineAssignment.count({
    where: {
      menuId,
      enabled: true,
      line: {
        isActive: true
      }
    }
  });
  return count > 0;
}

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ADMIN", "KITCHEN", "POS", "MENU_DISPLAY"] });

    const [menus, categories] = await Promise.all([
      prisma.menu.findMany({
        include: {
          assignments: {
            include: {
              line: true
            }
          }
        },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }]
      }),
      prisma.menuCategory.findMany({
        where: { isActive: true },
        orderBy: { displayOrder: "asc" }
      })
    ]);

    return ok({ menus, categories });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
    const body = await parseJson(req, menuCreateSchema);

    const menu = await prisma.menu.create({
      data: {
        name: body.name,
        priceJpy: body.priceJpy,
        availability: body.availability,
        workloadSeconds: body.workloadSeconds,
        displayOrder: body.displayOrder,
        categoryId: body.categoryId,
        showLeadTime: body.showLeadTime ?? true
      }
    });

    await writeAuditLog(prisma, {
      actorId: actor.actorId,
      actorType: actor.actorType,
      actionType: "MENU_CREATED",
      entityType: "menu",
      entityId: menu.id,
      afterJson: menu,
      result: "SUCCESS"
    });

    return ok({ menu });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
    const body = await parseJson(req, menuUpdateSchema);

    const before = await prisma.menu.findUnique({ where: { id: body.id } });
    if (!before) {
      throw new AppError(404, "MENU_NOT_FOUND", "menu not found");
    }

    if (body.availability === "AVAILABLE") {
      const covered = await hasActiveCoverage(body.id);
      if (!covered) {
        throw new AppError(409, "NO_ACTIVE_LINE", "Cannot set AVAILABLE without active line assignment");
      }
    }

    const menu = await prisma.menu.update({
      where: { id: body.id },
      data: {
        name: body.name,
        priceJpy: body.priceJpy,
        availability: body.availability,
        workloadSeconds: body.workloadSeconds,
        displayOrder: body.displayOrder,
        categoryId: body.categoryId,
        isActive: body.isActive,
        showLeadTime: body.showLeadTime
      }
    });

    await writeAuditLog(prisma, {
      actorId: actor.actorId,
      actorType: actor.actorType,
      actionType: "MENU_UPDATED",
      entityType: "menu",
      entityId: menu.id,
      beforeJson: before,
      afterJson: menu,
      result: "SUCCESS"
    });

    return ok({ menu });
  } catch (error) {
    return fail(error);
  }
}


