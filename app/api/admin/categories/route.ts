import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { writeAuditLog } from "@/lib/domain/audit";
import { withRouteTrace, traceError } from "@/lib/server/trace";
import { AppError } from "@/lib/errors";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

const BADGE_COLOR_HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

const createSchema = z.object({
  name: z.string().min(1).max(120),
  displayOrder: z.number().int().min(0).max(999),
  customBadgeText: z.string().trim().max(32).nullish(),
  customBadgeColor: z.string().trim().max(16).nullish(),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
  customBadgeText: z.string().trim().max(32).nullish(),
  customBadgeColor: z.string().trim().max(16).nullish(),
});

function normalizeCategoryBadgeInput(params: {
  customBadgeText?: string | null;
  customBadgeColor?: string | null;
}) {
  const customBadgeText = params.customBadgeText?.trim() ?? "";
  const customBadgeColor = params.customBadgeColor?.trim() ?? "";
  if (!customBadgeText) {
    return {
      customBadgeText: null,
      customBadgeColor: null,
    };
  }
  if (!BADGE_COLOR_HEX_REGEX.test(customBadgeColor)) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "カテゴリバッジ色は #RRGGBB 形式で入力してください",
    );
  }
  return {
    customBadgeText,
    customBadgeColor,
  };
}

type CategoryOrderNormalization = {
  applied: boolean;
  updatedCategoryCount: number;
};

async function normalizeActiveCategoryDisplayOrder(
  tx: Prisma.TransactionClient,
): Promise<CategoryOrderNormalization> {
  const activeCategories = await tx.menuCategory.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      displayOrder: true,
    },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }, { id: "asc" }],
  });

  const seenOrder = new Set<number>();
  let needsNormalization = false;

  for (const category of activeCategories) {
    if (category.displayOrder == null) {
      needsNormalization = true;
      break;
    }
    if (seenOrder.has(category.displayOrder)) {
      needsNormalization = true;
      break;
    }
    seenOrder.add(category.displayOrder);
  }

  if (!needsNormalization) {
    return {
      applied: false,
      updatedCategoryCount: 0,
    };
  }

  let updatedCategoryCount = 0;
  for (let index = 0; index < activeCategories.length; index += 1) {
    const category = activeCategories[index];
    const nextDisplayOrder = index + 1;
    if (category.displayOrder === nextDisplayOrder) {
      continue;
    }
    await tx.menuCategory.update({
      where: { id: category.id },
      data: { displayOrder: nextDisplayOrder },
    });
    updatedCategoryCount += 1;
  }

  return {
    applied: true,
    updatedCategoryCount,
  };
}

export async function GET(req: NextRequest) {
  return withRouteTrace(req, "admin/categories.GET", async (trace) => {
    try {
      trace("auth.start");
      await requireSession(req, { actorTypes: ["ADMIN", "POS", "MENU_DISPLAY"] });
      trace("auth.ok");

      const data = await prisma.$transaction(async (tx) => {
        const orderNormalization = await normalizeActiveCategoryDisplayOrder(tx);
        if (orderNormalization.applied) {
          await broadcastInvalidation(
            tx,
            CHANNEL_GROUPS.CATEGORIES,
            "categories",
            "category_order_auto_corrected",
          );
        }

        const categories = await tx.menuCategory.findMany({
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        });
        return { categories, orderNormalization };
      });
      trace("db.findMany.ok", {
        count: data.categories.length,
        autoCorrected: data.orderNormalization.applied,
        autoCorrectedCount: data.orderNormalization.updatedCategoryCount,
      });

      return ok({
        categories: data.categories,
        displayOrderAutoCorrected: data.orderNormalization.applied,
        displayOrderAutoCorrectedCount:
          data.orderNormalization.updatedCategoryCount,
      });
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}

export async function POST(req: NextRequest) {
  return withRouteTrace(req, "admin/categories.POST", async (trace) => {
    try {
      trace("auth.start");
      const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
      trace("auth.ok", { actorId: actor.actorId });

      const body = await parseJson(req, createSchema);
      trace("parseJson.ok", { name: body.name });
      const badge = normalizeCategoryBadgeInput({
        customBadgeText: body.customBadgeText,
        customBadgeColor: body.customBadgeColor,
      });

      const category = await prisma.$transaction(async (tx) => {
        const created = await tx.menuCategory.create({
          data: {
            name: body.name,
            displayOrder: body.displayOrder,
            customBadgeText: badge.customBadgeText,
            customBadgeColor: badge.customBadgeColor,
          },
        });

        await writeAuditLog(tx, {
          actorId: actor.actorId,
          actorType: actor.actorType,
          actionType: "MENU_CATEGORY_CREATED",
          entityType: "menu_category",
          entityId: created.id,
          afterJson: created,
          result: "SUCCESS"
        });

        await broadcastInvalidation(tx, CHANNEL_GROUPS.CATEGORIES, "categories", "category_created");
        return created;
      });
      trace("db.create.ok", { categoryId: category.id });

      return ok({ category });
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}

export async function PATCH(req: NextRequest) {
  return withRouteTrace(req, "admin/categories.PATCH", async (trace) => {
    try {
      trace("auth.start");
      const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
      trace("auth.ok", { actorId: actor.actorId });

      const body = await parseJson(req, updateSchema);
      trace("parseJson.ok", { categoryId: body.id });

      const before = await prisma.menuCategory.findUnique({ where: { id: body.id } });
      if (!before) {
        throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
      }

      const shouldUpdateBadge =
        body.customBadgeText !== undefined || body.customBadgeColor !== undefined;
      const badgePatch = shouldUpdateBadge
        ? normalizeCategoryBadgeInput({
            customBadgeText: body.customBadgeText ?? before.customBadgeText,
            customBadgeColor: body.customBadgeColor ?? before.customBadgeColor,
          })
        : null;

      const category = await prisma.$transaction(async (tx) => {
        const updated = await tx.menuCategory.update({
          where: { id: body.id },
          data: {
            name: body.name,
            displayOrder: body.displayOrder,
            isActive: body.isActive,
            ...(badgePatch
              ? {
                  customBadgeText: badgePatch.customBadgeText,
                  customBadgeColor: badgePatch.customBadgeColor,
                }
              : {}),
          }
        });

        await writeAuditLog(tx, {
          actorId: actor.actorId,
          actorType: actor.actorType,
          actionType: "MENU_CATEGORY_UPDATED",
          entityType: "menu_category",
          entityId: updated.id,
          beforeJson: before,
          afterJson: updated,
          result: "SUCCESS"
        });

        await broadcastInvalidation(tx, CHANNEL_GROUPS.CATEGORIES, "categories", "category_updated");
        return updated;
      });
      trace("db.update.ok", { categoryId: category.id });

      return ok({ category });
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}

export async function DELETE(req: NextRequest) {
  return withRouteTrace(req, "admin/categories.DELETE", async (trace) => {
    try {
      trace("auth.start");
      const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
      trace("auth.ok", { actorId: actor.actorId });

      const categoryId = req.nextUrl.searchParams.get("id");
      if (!categoryId) {
        throw new AppError(400, "CATEGORY_ID_REQUIRED", "id query parameter is required");
      }

      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.menuCategory.findUnique({
          where: { id: categoryId },
          select: {
            id: true,
            name: true,
            isActive: true,
            displayOrder: true,
          }
        });

        if (!existing) {
          throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
        }

        const activeMenuCount = await tx.menu.count({
          where: {
            categoryId,
            isActive: true,
          },
        });
        if (activeMenuCount > 0) {
          throw new AppError(
            409,
            "CATEGORY_HAS_ACTIVE_MENUS",
            "カテゴリ内にメニューが残っているため削除できません",
          );
        }

        let shiftedCategoryCount = 0;
        if (existing.displayOrder != null) {
          const shifted = await tx.menuCategory.updateMany({
            where: {
              isActive: true,
              displayOrder: { gt: existing.displayOrder },
            },
            data: {
              displayOrder: {
                decrement: 1,
              },
            },
          });
          shiftedCategoryCount = shifted.count;
        }

        await tx.menuCategory.update({
          where: { id: categoryId },
          data: {
            isActive: false,
            displayOrder: null,
          },
        });

        await writeAuditLog(tx, {
          actorId: actor.actorId,
          actorType: actor.actorType,
          actionType: "MENU_CATEGORY_DELETED",
          entityType: "menu_category",
          entityId: categoryId,
          beforeJson: {
            isActive: existing.isActive,
            name: existing.name,
            displayOrder: existing.displayOrder,
          },
          afterJson: {
            isActive: false,
            displayOrder: null,
            shiftedCategoryCount,
          },
          result: "SUCCESS"
        });

        await broadcastInvalidation(tx, CHANNEL_GROUPS.CATEGORIES, "categories", "category_deleted");

        return {
          categoryId,
          shiftedCategoryCount,
        };
      });

      return ok(result);
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}
