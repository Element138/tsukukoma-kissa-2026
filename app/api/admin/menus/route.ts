import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { menuCreateSchema, menuUpdateSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/domain/audit";
import { getMenuCapStates } from "@/lib/domain/menu-cap";
import { withRouteTrace, traceError } from "@/lib/server/trace";
import { AppError } from "@/lib/errors";
import {
  broadcastInvalidation,
  CHANNEL_GROUPS,
} from "@/lib/server/realtime-broadcast";

type DbClient = typeof prisma | Prisma.TransactionClient;

async function hasActiveCoverage(db: DbClient, menuId: string) {
  const count = await db.menuKitchenAssignment.count({
    where: {
      menuId,
      enabled: true,
      kitchenActor: {
        actorType: "KITCHEN",
        isActive: true,
        kitchenEnabled: true,
      },
    },
  });
  return count > 0;
}

function isAvailabilityWithCoverage(
  availability: "AVAILABLE" | "INCREASED_WAIT" | "PAUSED" | "SOLD_OUT",
) {
  return availability === "AVAILABLE" || availability === "INCREASED_WAIT";
}

function isPosAvailabilityOnlyPatch(
  body: ReturnType<typeof menuUpdateSchema.parse>,
) {
  const editableKeys: Array<keyof typeof body> = [
    "name",
    "shortName",
    "priceJpy",
    "workloadSeconds",
    "displayOrder",
    "categoryId",
    "kitchenId",
    "isActive",
    "showLeadTime",
    "coverImageDataUrl",
    "allergensJson",
    "allergenDisplayEnabled",
    "customBadgeText",
    "customBadgeColor",
    "dailyOrderCap",
    "lowStockBadgeEnabled",
    "lowStockBadgeThreshold",
  ];

  return (
    editableKeys.every((key) => body[key] === undefined) &&
    body.availability !== undefined
  );
}

async function assertKitchenActor(tx: Prisma.TransactionClient, kitchenId: string) {
  const kitchenActor = await tx.actor.findUnique({
    where: { id: kitchenId },
    select: {
      id: true,
      actorType: true,
    },
  });
  if (!kitchenActor || kitchenActor.actorType !== "KITCHEN") {
    throw new AppError(
      400,
      "INVALID_KITCHEN_ACTOR",
      "kitchenId must reference a KITCHEN actor",
    );
  }
}

export async function GET(req: NextRequest) {
  return withRouteTrace(req, "admin/menus.GET", async (trace) => {
    try {
      trace("auth.start");
      await requireSession(req, {
        actorTypes: ["ADMIN", "KITCHEN", "POS", "MENU_DISPLAY"],
      });
      trace("auth.ok");

      trace("db.read.start");
      const [menus, categories, enabledAssignments] = await Promise.all([
        prisma.menu.findMany({
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }, { id: "asc" }],
        }),
        prisma.menuCategory.findMany({
          where: { isActive: true },
          orderBy: { displayOrder: "asc" },
        }),
        prisma.menuKitchenAssignment.findMany({
          where: { enabled: true },
          select: {
            menuId: true,
            kitchenId: true,
            kitchenActor: {
              select: {
                actorType: true,
                isActive: true,
                kitchenEnabled: true,
              },
            },
          },
          orderBy: [{ menuId: "asc" }, { updatedAt: "desc" }],
        }),
      ]);
      const capStateMap = await getMenuCapStates(
        prisma,
        menus.map((menu) => ({
          menuId: menu.id,
          dailyOrderCap: menu.dailyOrderCap ?? null,
        })),
      );
      trace("db.read.ok", {
        menuCount: menus.length,
        categoryCount: categories.length,
      });

      const assignedKitchenByMenuId = new Map<string, string>();
      const coveredMenuIds = new Set<string>();
      for (const assignment of enabledAssignments) {
        if (!assignedKitchenByMenuId.has(assignment.menuId)) {
          assignedKitchenByMenuId.set(assignment.menuId, assignment.kitchenId);
        }
        if (
          assignment.kitchenActor.actorType === "KITCHEN" &&
          assignment.kitchenActor.isActive &&
          assignment.kitchenActor.kitchenEnabled
        ) {
          coveredMenuIds.add(assignment.menuId);
        }
      }

      return ok({
        menus: menus.map((menu) => {
          const capState = capStateMap.get(menu.id);
          const isCapReached = capState?.isCapReached ?? false;
          return {
            ...menu,
            availability: isCapReached ? "SOLD_OUT" : menu.availability,
            assignedKitchenId: assignedKitchenByMenuId.get(menu.id) ?? null,
            hasActiveKitchenCoverage: coveredMenuIds.has(menu.id),
            todayOrderCount: capState?.todayCount ?? 0,
            remainingUntilCap: capState?.remainingUntilCap ?? null,
            isCapReached,
          };
        }),
        categories,
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
      trace("parseJson.ok", {
        name: body.name,
        categoryId: body.categoryId,
        kitchenId: body.kitchenId,
      });

      trace("tx.create.start");
      const menu = await prisma.$transaction(async (tx) => {
        await assertKitchenActor(tx, body.kitchenId);

        const created = await tx.menu.create({
          data: {
            name: body.name,
            shortName: body.shortName ?? null,
            priceJpy: body.priceJpy,
            availability: body.availability,
            workloadSeconds: body.workloadSeconds,
            displayOrder: body.displayOrder,
            categoryId: body.categoryId,
            showLeadTime: body.showLeadTime ?? true,
            coverImageDataUrl: body.coverImageDataUrl ?? null,
            allergensJson: body.allergensJson ?? [],
            allergenDisplayEnabled: body.allergenDisplayEnabled ?? false,
            customBadgeText: body.customBadgeText ?? null,
            customBadgeColor: body.customBadgeColor ?? null,
            dailyOrderCap: body.dailyOrderCap ?? null,
            lowStockBadgeEnabled: body.lowStockBadgeEnabled ?? false,
            lowStockBadgeThreshold: body.lowStockBadgeThreshold ?? 0,
          },
        });

        await tx.menuKitchenAssignment.upsert({
          where: {
            menuId_kitchenId: {
              menuId: created.id,
              kitchenId: body.kitchenId,
            },
          },
          create: {
            menuId: created.id,
            kitchenId: body.kitchenId,
            enabled: true,
          },
          update: {
            enabled: true,
          },
        });

        await tx.menuKitchenAssignment.updateMany({
          where: {
            menuId: created.id,
            kitchenId: {
              not: body.kitchenId,
            },
            enabled: true,
          },
          data: {
            enabled: false,
          },
        });

        if (
          isAvailabilityWithCoverage(created.availability) &&
          !(await hasActiveCoverage(tx, created.id))
        ) {
          throw new AppError(
            409,
            "NO_ACTIVE_KITCHEN",
            "Cannot set AVAILABLE/INCREASED_WAIT without an active kitchen assignment",
          );
        }

        await writeAuditLog(tx, {
          actorId: actor.actorId,
          actorType: actor.actorType,
          actionType: "MENU_CREATED",
          entityType: "menu",
          entityId: created.id,
          afterJson: {
            ...created,
            kitchenId: body.kitchenId,
          },
          result: "SUCCESS",
        });

        await broadcastInvalidation(
          tx,
          [...CHANNEL_GROUPS.MENUS, ...CHANNEL_GROUPS.ASSIGNMENTS],
          "menus",
          "menu_created",
        );
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
        throw new AppError(
          403,
          "FORBIDDEN",
          "POS can only update menu availability",
        );
      }

      const before = await prisma.menu.findUnique({ where: { id: body.id } });
      if (!before) {
        throw new AppError(404, "MENU_NOT_FOUND", "menu not found");
      }

      if (!before.isActive) {
        throw new AppError(
          409,
          "MENU_DELETED",
          "Deleted menu cannot be edited",
        );
      }

      if (body.isActive === true) {
        throw new AppError(
          409,
          "MENU_DELETE_PERMANENT",
          "Deleted menu cannot be restored",
        );
      }

      trace("tx.update.start");
      const menu = await prisma.$transaction(async (tx) => {
        if (body.kitchenId !== undefined) {
          await assertKitchenActor(tx, body.kitchenId);

          await tx.menuKitchenAssignment.upsert({
            where: {
              menuId_kitchenId: {
                menuId: body.id,
                kitchenId: body.kitchenId,
              },
            },
            create: {
              menuId: body.id,
              kitchenId: body.kitchenId,
              enabled: true,
            },
            update: {
              enabled: true,
            },
          });

          await tx.menuKitchenAssignment.updateMany({
            where: {
              menuId: body.id,
              kitchenId: {
                not: body.kitchenId,
              },
              enabled: true,
            },
            data: {
              enabled: false,
            },
          });
        }

        const nextDailyOrderCap =
          body.dailyOrderCap !== undefined
            ? body.dailyOrderCap
            : before.dailyOrderCap;
        const nextAvailability =
          body.isActive === false
            ? "PAUSED"
            : (body.availability ?? before.availability);
        const capStateMap = await getMenuCapStates(tx, [
          {
            menuId: body.id,
            dailyOrderCap: nextDailyOrderCap ?? null,
          },
        ]);
        const capState = capStateMap.get(body.id);
        if (
          capState?.isCapReached &&
          body.availability !== undefined &&
          (body.availability === "AVAILABLE" ||
            body.availability === "INCREASED_WAIT" ||
            body.availability === "PAUSED")
        ) {
          throw new AppError(
            409,
            "MENU_CAP_REACHED",
            "本日の上限に達しているため販売状態を変更できません",
          );
        }
        if (
          isAvailabilityWithCoverage(nextAvailability) &&
          !(await hasActiveCoverage(tx, body.id))
        ) {
          throw new AppError(
            409,
            "NO_ACTIVE_KITCHEN",
            "Cannot set AVAILABLE/INCREASED_WAIT without an active kitchen assignment",
          );
        }

        let shiftedMenuCount = 0;
        if (body.isActive === false && before.displayOrder != null) {
          const shifted = await tx.menu.updateMany({
            where: {
              isActive: true,
              categoryId: before.categoryId,
              displayOrder: {
                gt: before.displayOrder,
              },
            },
            data: {
              displayOrder: {
                decrement: 1,
              },
            },
          });
          shiftedMenuCount = shifted.count;
        }

        const updated = await tx.menu.update({
          where: { id: body.id },
          data: {
            name: body.name,
            shortName: body.shortName,
            priceJpy: body.priceJpy,
            availability: body.isActive === false ? "PAUSED" : body.availability,
            workloadSeconds: body.workloadSeconds,
            displayOrder: body.isActive === false ? null : body.displayOrder,
            categoryId: body.categoryId,
            isActive: body.isActive,
            showLeadTime: body.showLeadTime,
            coverImageDataUrl: body.coverImageDataUrl,
            allergensJson: body.allergensJson,
            allergenDisplayEnabled: body.allergenDisplayEnabled,
            customBadgeText: body.customBadgeText,
            customBadgeColor: body.customBadgeColor,
            dailyOrderCap: body.dailyOrderCap,
            lowStockBadgeEnabled: body.lowStockBadgeEnabled,
            lowStockBadgeThreshold: body.lowStockBadgeThreshold,
          },
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
          afterJson:
            body.isActive === false
              ? {
                  ...updated,
                  shiftedMenuCount,
                }
              : updated,
          result: "SUCCESS",
        });

        await broadcastInvalidation(
          tx,
          [...CHANNEL_GROUPS.MENUS, ...CHANNEL_GROUPS.ASSIGNMENTS],
          "menus",
          "menu_updated",
        );
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
