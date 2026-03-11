import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { writeAuditLog } from "@/lib/domain/audit";
import { withRouteTrace, traceError } from "@/lib/server/trace";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  displayOrder: z.number().int().min(0).max(999)
});

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional()
});

export async function GET(req: NextRequest) {
  return withRouteTrace(req, "admin/categories.GET", async (trace) => {
    try {
      trace("auth.start");
      await requireSession(req, { actorTypes: ["ADMIN", "POS", "MENU_DISPLAY"] });
      trace("auth.ok");

      const categories = await prisma.menuCategory.findMany({
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }]
      });
      trace("db.findMany.ok", { count: categories.length });

      return ok({ categories });
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

      const category = await prisma.$transaction(async (tx) => {
        const created = await tx.menuCategory.create({ data: body });

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
        return new Response("Not found", { status: 404 });
      }

      const category = await prisma.$transaction(async (tx) => {
        const updated = await tx.menuCategory.update({
          where: { id: body.id },
          data: {
            name: body.name,
            displayOrder: body.displayOrder,
            isActive: body.isActive
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
