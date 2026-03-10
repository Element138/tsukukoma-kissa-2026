import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { prisma } from "@/lib/db";
import { findOfflineActors, listQueuedItemsOnInactiveLines } from "@/lib/server/queries";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireSession(req);

    const [offlineActors, inactiveLineQueuedItems] = await Promise.all([
      findOfflineActors(prisma),
      listQueuedItemsOnInactiveLines(prisma)
    ]);

    return ok({
      actor,
      offlineActors,
      inactiveLineQueuedItems
    });
  } catch (error) {
    return fail(error);
  }
}


