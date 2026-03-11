import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { menuCreateSchema, menuUpdateSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/domain/audit";
import { withRouteTrace, traceError } from "@/lib/server/trace";
import { AppError } from "@/lib/errors";

async function hasActiveCoverage(menuId: string) {
  const count = await prisma.menuKitchenAssignment.count({
    where: {
      menuId,
      enabled: true,
      kitchenActor: {
        actorType: "KITCHEN",
        isActive: true,
        kitchenEnabled: true
      }
    }
  });
  return count > 0;
}

export async function GET(req: NextRequest) {
  return withRouteTrace(req, "admin/menus.GET", async (trace) => {
    try {
      trace("auth.start");
      await requireSession(req, { actorTypes: ["ADMIN", "KITCHEN", "POS", "MENU_DISPLAY"] });
      trace("auth.ok");

      trace("db.read.start");
      const [menus, categories] = await Promise.all([
        prisma.menu.findMany({
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }]
        }),
        prisma.menuCategory.findMany({
          where: { isActive: true },
          orderBy: { displayOrder: "asc" }
        })
      ]);
      trace("db.read.ok", { menuCount: menus.length, categoryCount: categories.length });

      return ok({ menus, categories });
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}

export async function POST(req: NextRequest) {
  return withRouteTrace(req, "admin/menus.POST", async (trace) => {
    try {
      trace("auth.start");
      const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
      trace("auth.ok", { actorId: actor.actorId });

      trace("parseJson.start");
      const body = await parseJson(req, menuCreateSchema);
      trace("parseJson.ok", { name: body.name, categoryId: body.categoryId });

      trace("db.create.start");
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
      trace("db.create.ok", { menuId: menu.id });

      trace("audit.start");
      await writeAuditLog(prisma, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        actionType: "MENU_CREATED",
        entityType: "menu",
        entityId: menu.id,
        afterJson: menu,
        result: "SUCCESS"
      });
      trace("audit.ok");

      return ok({ menu });
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}

export async function PATCH(req: NextRequest) {
  return withRouteTrace(req, "admin/menus.PATCH", async (trace) => {
    try {
      trace("auth.start");
      const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
      trace("auth.ok", { actorId: actor.actorId });

      trace("parseJson.start");
      const body = await parseJson(req, menuUpdateSchema);
      trace("parseJson.ok", { menuId: body.id });

      const before = await prisma.menu.findUnique({ where: { id: body.id } });
      if (!before) {
        throw new AppError(404, "MENU_NOT_FOUND", "menu not found");
      }

      if (body.availability === "AVAILABLE") {
        const covered = await hasActiveCoverage(body.id);
        if (!covered) {
          throw new AppError(409, "NO_ACTIVE_KITCHEN", "Cannot set AVAILABLE without active kitchen assignment");
        }
      }

      trace("db.update.start");
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
      trace("db.update.ok");

      trace("audit.start");
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
      trace("audit.ok");

      return ok({ menu });
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}