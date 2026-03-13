import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { actorCreateSchema, actorUpdateSchema } from "@/lib/validation";
import { hashSecret } from "@/lib/crypto";
import { writeAuditLog } from "@/lib/domain/audit";
import { updateMenusAvailabilityByKitchenCoverage } from "@/lib/domain/kitchen-assignment";
import { withRouteTrace, traceError } from "@/lib/server/trace";
import { AppError } from "@/lib/errors";
import { broadcastInvalidation, CHANNEL_GROUPS, kitchenChannel } from "@/lib/server/realtime-broadcast";

const actorPublicSelect = {
  id: true,
  actorType: true,
  label: true,
  isActive: true,
  online: true,
  kitchenEnabled: true,
  kitchenDisplayOrder: true
} as const;

function makeActorId(actorType: "POS" | "KITCHEN" | "WAITER" | "MENU_DISPLAY" | "ADMIN") {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  return `${actorType.toLowerCase()}-${suffix}`;
}

export async function GET(req: NextRequest) {
  return withRouteTrace(req, "admin/actors.GET", async (trace) => {
    try {
      trace("auth.start");
      const actor = await requireSession(req, { actorTypes: ["ADMIN", "KITCHEN"] });
      trace("auth.ok", { actorId: actor.actorId, actorType: actor.actorType });

      trace("db.findMany.start");
      const actors = await prisma.actor.findMany({
        where: actor.actorType === "KITCHEN" ? { actorType: "KITCHEN" } : undefined,
        select: actorPublicSelect,
        orderBy: [{ actorType: "asc" }, { kitchenDisplayOrder: "asc" }, { label: "asc" }, { id: "asc" }]
      });
      trace("db.findMany.ok", { count: actors.length });

      return ok({ actors });
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}

export async function POST(req: NextRequest) {
  return withRouteTrace(req, "admin/actors.POST", async (trace) => {
    try {
      trace("auth.start");
      const admin = await requireSession(req, { actorTypes: ["ADMIN"] });
      trace("auth.ok", { actorId: admin.actorId });

      trace("parseJson.start");
      const body = await parseJson(req, actorCreateSchema);
      trace("parseJson.ok", { actorType: body.actorType });

      if (body.actorType === "ADMIN") {
        throw new AppError(400, "INVALID_ACTOR_TYPE", "管理者アカウントは追加できません");
      }

      trace("tx.create.start");
      const actor = await prisma.$transaction(async (tx) => {
        if (body.actorType === "MENU_DISPLAY") {
          const existingCount = await tx.actor.count({
            where: {
              actorType: "MENU_DISPLAY"
            }
          });
          if (existingCount > 0) {
            throw new AppError(409, "MENU_DISPLAY_SINGLETON", "MENU_DISPLAY account can only be created once");
          }
        }

        const nextKitchenOrder =
          body.actorType === "KITCHEN" && typeof body.kitchenDisplayOrder !== "number"
            ? ((await tx.actor.aggregate({
                where: { actorType: "KITCHEN" },
                _max: { kitchenDisplayOrder: true }
              }))._max.kitchenDisplayOrder ?? -1) + 1
            : body.kitchenDisplayOrder ?? 0;

        const created = await tx.actor.create({
          data: {
            id: makeActorId(body.actorType),
            actorType: body.actorType,
            label: body.label,
            secretHash: hashSecret(body.secret),
            isActive: true,
            kitchenEnabled: body.actorType === "KITCHEN" ? (body.kitchenEnabled ?? true) : true,
            kitchenDisplayOrder: body.actorType === "KITCHEN" ? nextKitchenOrder : 0
          },
          select: actorPublicSelect
        });

        await writeAuditLog(tx, {
          actorId: admin.actorId,
          actorType: admin.actorType,
          actionType: "ACTOR_CREATED",
          entityType: "actor",
          entityId: created.id,
          afterJson: {
            actorType: created.actorType,
            label: created.label,
            kitchenEnabled: created.kitchenEnabled,
            kitchenDisplayOrder: created.kitchenDisplayOrder
          },
          result: "SUCCESS"
        });

        await broadcastInvalidation(
          tx,
          [
            ...CHANNEL_GROUPS.ACTORS,
            "assignments",
            ...(created.actorType === "KITCHEN" ? [kitchenChannel(created.id)] : [])
          ],
          "actors",
          "actor_created"
        );

        return created;
      });
      trace("tx.create.ok", { createdActorId: actor.id });

      return ok({ actor });
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}

export async function PATCH(req: NextRequest) {
  return withRouteTrace(req, "admin/actors.PATCH", async (trace) => {
    try {
      trace("auth.start");
      const admin = await requireSession(req, { actorTypes: ["ADMIN"] });
      trace("auth.ok", { actorId: admin.actorId });

      const body = await parseJson(req, actorUpdateSchema);
      trace("parseJson.ok", { actorId: body.id });

      const actor = await prisma.$transaction(async (tx) => {
        const before = await tx.actor.findUnique({
          where: { id: body.id },
          select: {
            id: true,
            actorType: true,
            label: true,
            kitchenEnabled: true,
            kitchenDisplayOrder: true
          }
        });

        if (!before) {
          throw new AppError(404, "ACTOR_NOT_FOUND", "Actor not found");
        }

        if (before.actorType !== "KITCHEN" && (typeof body.kitchenEnabled === "boolean" || typeof body.kitchenDisplayOrder === "number")) {
          throw new AppError(400, "INVALID_KITCHEN_FIELD", "Kitchen settings can be changed only for kitchen actors");
        }

        const updated = await tx.actor.update({
          where: { id: body.id },
          data: {
            label: body.label,
            secretHash: body.secret ? hashSecret(body.secret) : undefined,
            kitchenEnabled: body.kitchenEnabled,
            kitchenDisplayOrder: body.kitchenDisplayOrder
          },
          select: actorPublicSelect
        });

        await writeAuditLog(tx, {
          actorId: admin.actorId,
          actorType: admin.actorType,
          actionType: "ACTOR_UPDATED",
          entityType: "actor",
          entityId: updated.id,
          beforeJson: {
            label: before.label,
            kitchenEnabled: before.kitchenEnabled,
            kitchenDisplayOrder: before.kitchenDisplayOrder
          },
          afterJson: {
            label: updated.label,
            kitchenEnabled: updated.kitchenEnabled,
            kitchenDisplayOrder: updated.kitchenDisplayOrder,
            passwordUpdated: Boolean(body.secret)
          },
          result: "SUCCESS"
        });

        await broadcastInvalidation(
          tx,
          [...CHANNEL_GROUPS.ACTORS, ...(updated.actorType === "KITCHEN" ? [kitchenChannel(updated.id)] : [])],
          "actors",
          "actor_updated"
        );

        return updated;
      });

      return ok({ actor });
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}

export async function DELETE(req: NextRequest) {
  return withRouteTrace(req, "admin/actors.DELETE", async (trace) => {
    try {
      trace("auth.start");
      const admin = await requireSession(req, { actorTypes: ["ADMIN"] });
      trace("auth.ok", { actorId: admin.actorId });

      const actorId = req.nextUrl.searchParams.get("id");

      if (!actorId) {
        throw new AppError(400, "ACTOR_ID_REQUIRED", "id query parameter is required");
      }
      if (actorId === "admin") {
        throw new AppError(400, "INVALID_OPERATION", "admin actor cannot be deleted");
      }

      trace("tx.deactivate.start", { actorId });
      const target = await prisma.$transaction(async (tx) => {
        const existing = await tx.actor.findUnique({
          where: { id: actorId },
          select: { id: true, actorType: true, isActive: true }
        });

        if (!existing) {
          throw new AppError(404, "ACTOR_NOT_FOUND", "Actor not found");
        }

        if (existing.actorType === "MENU_DISPLAY") {
          throw new AppError(400, "INVALID_OPERATION", "MENU_DISPLAY actor cannot be deleted");
        }

        await tx.actor.update({
          where: { id: actorId },
          data: {
            isActive: false,
            online: false
          }
        });

        await tx.session.updateMany({
          where: {
            actorId,
            revokedAt: null
          },
          data: {
            revokedAt: new Date()
          }
        });

        if (existing.actorType === "KITCHEN") {
          const impacted = await tx.menuKitchenAssignment.findMany({
            where: { kitchenId: actorId, enabled: true },
            select: { menuId: true }
          });
          await updateMenusAvailabilityByKitchenCoverage(tx, [...new Set(impacted.map((x) => x.menuId))]);
        }

        await writeAuditLog(tx, {
          actorId: admin.actorId,
          actorType: admin.actorType,
          actionType: "ACTOR_DELETED",
          entityType: "actor",
          entityId: actorId,
          beforeJson: { actorType: existing.actorType, isActive: existing.isActive },
          afterJson: { actorType: existing.actorType, isActive: false },
          result: "SUCCESS"
        });

        await broadcastInvalidation(
          tx,
          [
            ...CHANNEL_GROUPS.ACTORS,
            "assignments",
            ...(existing.actorType === "KITCHEN" ? [kitchenChannel(actorId)] : [])
          ],
          "actors",
          "actor_deleted"
        );

        return existing;
      });
      trace("tx.deactivate.ok", { actorType: target.actorType });

      return ok({ actorId, deleted: true });
    } catch (error) {
      traceError(trace, "error", error);
      return fail(error);
    }
  });
}

