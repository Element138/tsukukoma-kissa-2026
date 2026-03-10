import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { writeAuditLog } from "@/lib/domain/audit";

const schema = z.object({
  actorId: z.string().min(1).max(64)
});

export async function POST(req: NextRequest) {
  try {
    const admin = await requireSession(req, { actorTypes: ["ADMIN"] });
    const body = await parseJson(req, schema);

    const result = await prisma.session.updateMany({
      where: {
        actorId: body.actorId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });

    await prisma.actor.updateMany({
      where: { id: body.actorId },
      data: {
        online: false
      }
    });

    await writeAuditLog(prisma, {
      actorId: admin.actorId,
      actorType: admin.actorType,
      actionType: "FORCE_LOGOUT",
      entityType: "actor",
      entityId: body.actorId,
      afterJson: {
        revokedSessions: result.count
      },
      result: "SUCCESS"
    });

    return ok({ revokedSessions: result.count });
  } catch (error) {
    return fail(error);
  }
}


