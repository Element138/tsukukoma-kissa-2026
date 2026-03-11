import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { loginSchema } from "@/lib/validation";
import { parseJson } from "@/lib/server/http";
import { verifySecret } from "@/lib/crypto";
import { createSession, setSessionCookie } from "@/lib/server/auth";
import { writeAuditLog } from "@/lib/domain/audit";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

export async function POST(req: NextRequest) {
  try {
    const body = await parseJson(req, loginSchema);

    const actor = await prisma.actor.findUnique({
      where: { id: body.actorId }
    });

    if (!actor || !actor.isActive || !verifySecret(body.secret, actor.secretHash)) {
      await writeAuditLog(prisma, {
        actorId: actor?.id ?? null,
        actorType: actor?.actorType ?? null,
        actionType: "LOGIN",
        entityType: "actor",
        entityId: body.actorId,
        result: "FAILURE",
        reasonType: "INVALID_CREDENTIALS"
      });

      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid actor id or secret"
          }
        },
        { status: 401 }
      );
    }

    const session = await prisma.$transaction(async (tx) => {
      const createdSession = await createSession({ id: actor.id, actorType: actor.actorType }, tx);

      await tx.actor.update({
        where: { id: actor.id },
        data: {
          online: true,
          lastSeenAt: new Date()
        }
      });

      await writeAuditLog(tx, {
        actorId: actor.id,
        actorType: actor.actorType,
        actionType: "LOGIN",
        entityType: "actor",
        entityId: actor.id,
        result: "SUCCESS"
      });

      await broadcastInvalidation(tx, CHANNEL_GROUPS.ACTORS, "actors", "login");

      return createdSession;
    });

    const response = ok({
      actorId: actor.id,
      actorType: actor.actorType,
      label: actor.label
    });
    setSessionCookie(response, session.token);
    return response;
  } catch (error) {
    return fail(error);
  }
}
