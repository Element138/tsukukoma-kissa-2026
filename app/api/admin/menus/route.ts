import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { menuCreateSchema, menuUpdateSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/domain/audit";
import { withRouteTrace, traceError } from "@/lib/server/trace";
import { AppError } from "@/lib/errors";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

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

function isPosAvailabilityOnlyPatch(body: ReturnType<typeof menuUpdateSchema.parse>) {
  const editableKeys: Array<keyof typeof body> = [
    "name",
    "priceJpy",
    "workloadSeconds",
    "displayOrder",
    "categoryId",
    "isActive",
    "showLeadTime"
  ];

  return editableKeys.every((key) => body[key] === undefined) && body.availability !== undefined;
}

export async function GET(req: NextRequest) {
  return withRouteTrace(req, "admin/menus.GET", async (trace) => {
    try {
      trace("auth.start");
      await requireSession(req, { actorTypes: ["ADMIN", "KITCHEN", "POS", "MENU_DISPLAY"] });
      trace("auth.ok");

      trace("db.read.start");
      const [menus, categories, activeAssignments] = await Promise.all([
        prisma.menu.findMany({
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }]
        }),
        prisma.menuCategory.findMany({
          where: { isActive: true },
          orderBy: { displayOrder: "asc" }
        }),
        prisma.menuKitchenAssignment.findMany({
          where: {
            enabled: true,
            kitchenActor: {
              actorType: "KITCHEN",
              isActive: true,
              kitchenEnabled: true
            }
          },
          select: {
            menuId: true
          }
        })
      ]);
      trace("db.read.ok", { menuCount: menus.length, categoryCount: categories.length });

      const coveredMenuIds = new Set(activeAssignments.map((row) => row.menuId));

      return ok({
        menus: menus.map((menu) => ({
          ...menu,
          hasActiveKitchenCoverage: coveredMenuIds.has(menu.id)
        })),
        categories
      });
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

      trace("tx.create.start");
      const menu = await prisma.$transaction(async (tx) => {
        const created = await tx.menu.create({
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

        await writeAuditLog(tx, {
          actorId: actor.actorId,
          actorType: actor.actorType,
          actionType: "MENU_CREATED",
          entityType: "menu",
          entityId: created.id,
          afterJson: created,
          result: "SUCCESS"
        });

        await broadcastInvalidation(tx, CHANNEL_GROUPS.MENUS, "menus", "menu_created");
        return created;
      });
      trace("tx.create.ok", { menuId: menu.id });

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
      const actor = await requireSession(req, { actorTypes: ["ADMIN", "POS"] });
      trace("auth.ok", { actorId: actor.actorId, actorType: actor.actorType });

      trace("parseJson.start");
      const body = await parseJson(req, menuUpdateSchema);
      trace("parseJson.ok", { menuId: body.id });

      if (actor.actorType === "POS" && !isPosAvailabilityOnlyPatch(body)) {
        throw new AppError(403, "FORBIDDEN", "POS can only update menu availability");
      }

      const before = await prisma.menu.findUnique({ where: { id: body.id } });
      if (!before) {
        throw new AppError(404, "MENU_NOT_FOUND", "menu not found");
      }

      if (!before.isActive) {
        throw new AppError(409, "MENU_DELETED", "Deleted menu cannot be edited");
      }

      if (body.isActive === true) {
        throw new AppError(409, "MENU_DELETE_PERMANENT", "Deleted menu cannot be restored");
      }

      if (body.availability === "AVAILABLE") {
        const covered = await hasActiveCoverage(body.id);
        if (!covered) {
          throw new AppError(409, "NO_ACTIVE_KITCHEN", "Cannot set AVAILABLE without active kitchen assignment");
        }
      }

      trace("tx.update.start");
      const menu = await prisma.$transaction(async (tx) => {
        const updated = await tx.menu.update({
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

        const actionType =
          body.isActive === false
            ? "MENU_DELETED"
            : actor.actorType === "POS"
              ? "MENU_AVAILABILITY_UPDATED"
              : "MENU_UPDATED";

        await writeAuditLog(tx, {
          actorId: actor.actorId,
          actorType: actor.actorType,
          actionType,
          entityType: "menu",
          entityId: updated.id,
          beforeJson: before,
          afterJson: updated,
          result: "SUCCESS"
        });

        await broadcastInvalidation(tx, CHANNEL_GROUPS.MENUS, "menus", "menu_updated");
        return updated;
      });
      trace("tx.update.ok", { menuId: menu.id });

      return ok({ menu });
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}
