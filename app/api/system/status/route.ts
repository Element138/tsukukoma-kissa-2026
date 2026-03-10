import { NextRequest } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { prisma } from "@/lib/db";
import { findOfflineActors, listQueuedItemsOnInactiveLines } from "@/lib/server/queries";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req);

    const [offlineActors, inactiveLineQueuedItems] = await Promise.all([
      findOfflineActors(prisma),
      listQueuedItemsOnInactiveLines(prisma)
    ]);

    return ok({
      serverTime: new Date().toISOString(),
      offlineActors,
      inactiveLineQueuedItems
    });
  } catch (error) {
    return fail(error);
  }
}


