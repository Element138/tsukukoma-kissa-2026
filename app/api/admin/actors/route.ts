import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { actorCreateSchema } from "@/lib/validation";
import { hashSecret } from "@/lib/crypto";
import { writeAuditLog } from "@/lib/domain/audit";
import { updateMenusAvailabilityByKitchenCoverage } from "@/lib/domain/kitchen-assignment";
import { AppError } from "@/lib/errors";

const actorPublicSelect = {
  id: true,
  actorType: true,
  label: true,
  isActive: true,
  online: true,
  kitchenEnabled: true,
  kitchenDisplayOrder: true
} as const;

export async function GET(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["ADMIN", "KITCHEN"] });

    const actors = await prisma.actor.findMany({
      where: actor.actorType === "KITCHEN" ? { actorType: "KITCHEN" } : undefined,
      select: actorPublicSelect,
      orderBy: [{ actorType: "asc" }, { kitchenDisplayOrder: "asc" }, { id: "asc" }]
    });

    return ok({ actors });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireSession(req, { actorTypes: ["ADMIN"] });
    const body = await parseJson(req, actorCreateSchema);

    if (body.actorType === "ADMIN" && body.id !== "admin") {
      throw new AppError(400, "INVALID_ADMIN_ID", "Admin ID must be 'admin'");
    }

    const actor = await prisma.$transaction(async (tx) => {
      const nextKitchenOrder =
        body.actorType === "KITCHEN" && typeof body.kitchenDisplayOrder !== "number"
          ? ((await tx.actor.aggregate({
              where: { actorType: "KITCHEN" },
              _max: { kitchenDisplayOrder: true }
            }))._max.kitchenDisplayOrder ?? -1) + 1
          : body.kitchenDisplayOrder ?? 0;

      return tx.actor.create({
        data: {
          id: body.id,
          actorType: body.actorType,
          label: body.label,
          secretHash: hashSecret(body.secret),
          isActive: true,
          kitchenEnabled: body.actorType === "KITCHEN" ? (body.kitchenEnabled ?? true) : true,
          kitchenDisplayOrder: body.actorType === "KITCHEN" ? nextKitchenOrder : 0
        },
        select: actorPublicSelect
      });
    });

    await writeAuditLog(prisma, {
      actorId: admin.actorId,
      actorType: admin.actorType,
      actionType: "ACTOR_CREATED",
      entityType: "actor",
      entityId: actor.id,
      afterJson: {
        actorType: actor.actorType,
        label: actor.label,
        kitchenEnabled: actor.kitchenEnabled,
        kitchenDisplayOrder: actor.kitchenDisplayOrder
      },
      result: "SUCCESS"
    });

    return ok({ actor });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const admin = await requireSession(req, { actorTypes: ["ADMIN"] });
    const actorId = req.nextUrl.searchParams.get("id");

    if (!actorId) {
      throw new AppError(400, "ACTOR_ID_REQUIRED", "id query parameter is required");
    }
    if (actorId === "admin") {
      throw new AppError(400, "INVALID_OPERATION", "admin actor cannot be deleted");
    }

    const target = await prisma.$transaction(async (tx) => {
      const existing = await tx.actor.findUnique({
        where: { id: actorId },
        select: { id: true, actorType: true, isActive: true }
      });

      if (!existing) {
        throw new AppError(404, "ACTOR_NOT_FOUND", "Actor not found");
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

      return existing;
    });

    await writeAuditLog(prisma, {
      actorId: admin.actorId,
      actorType: admin.actorType,
      actionType: "ACTOR_DEACTIVATED",
      entityType: "actor",
      entityId: actorId,
      beforeJson: { actorType: target.actorType, isActive: target.isActive },
      afterJson: { actorType: target.actorType, isActive: false },
      result: "SUCCESS"
    });

    return ok({ actorId, deactivated: true });
  } catch (error) {
    return fail(error);
  }
}