import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { actorCreateSchema } from "@/lib/validation";
import { hashSecret } from "@/lib/crypto";
import { writeAuditLog } from "@/lib/domain/audit";
import { AppError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ADMIN"] });

    const actors = await prisma.actor.findMany({
      orderBy: [{ actorType: "asc" }, { id: "asc" }]
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
    if (body.actorType === "KITCHEN" && !body.lineId) {
      throw new AppError(400, "LINE_REQUIRED", "Kitchen actor requires lineId");
    }

    const actor = await prisma.actor.create({
      data: {
        id: body.id,
        actorType: body.actorType,
        lineId: body.lineId ?? null,
        label: body.label,
        secretHash: hashSecret(body.secret),
        isActive: true
      }
    });

    await writeAuditLog(prisma, {
      actorId: admin.actorId,
      actorType: admin.actorType,
      actionType: "ACTOR_CREATED",
      entityType: "actor",
      entityId: actor.id,
      afterJson: {
        actorType: actor.actorType,
        lineId: actor.lineId,
        label: actor.label
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

    await prisma.actor.update({
      where: { id: actorId },
      data: {
        isActive: false,
        online: false
      }
    });

    await prisma.session.updateMany({
      where: {
        actorId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });

    await writeAuditLog(prisma, {
      actorId: admin.actorId,
      actorType: admin.actorType,
      actionType: "ACTOR_DEACTIVATED",
      entityType: "actor",
      entityId: actorId,
      result: "SUCCESS"
    });

    return ok({ actorId, deactivated: true });
  } catch (error) {
    return fail(error);
  }
}


