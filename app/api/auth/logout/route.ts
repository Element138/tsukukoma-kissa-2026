import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/response";
import { clearSessionCookie, requireSession, revokeCurrentSession } from "@/lib/server/auth";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/domain/audit";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req);
    await revokeCurrentSession(req);

    await prisma.actor.update({
      where: { id: actor.actorId },
      data: {
        online: false
      }
    });

    await writeAuditLog(prisma, {
      actorId: actor.actorId,
      actorType: actor.actorType,
      actionType: "LOGOUT",
      entityType: "actor",
      entityId: actor.actorId,
      result: "SUCCESS"
    });

    const res = ok({ success: true });
    clearSessionCookie(res);
    return res;
  } catch (error) {
    return fail(error);
  }
}


