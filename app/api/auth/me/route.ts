import { NextRequest } from "next/server";
import { requireSession, SESSION_COOKIE, setSessionCookie } from "@/lib/server/auth";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { findOfflineActors } from "@/lib/server/queries";
import { schedulePublicWaitTimeRefresh } from "@/lib/server/public-wait-time-refresh";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireSession(req);

    const offlineActors = await findOfflineActors(prisma);

    const response = ok({
      actor,
      offlineActors
    });

    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (token) {
      setSessionCookie(response, token, actor.actorType);
    }

    schedulePublicWaitTimeRefresh();
    return response;
  } catch (error) {
    return fail(error);
  }
}
