import { NextRequest } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { prisma } from "@/lib/db";
import { findOfflineActors, listQueuedItemsOnInactiveKitchens } from "@/lib/server/queries";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req);

    const [offlineActors, inactiveKitchenQueuedItems] = await Promise.all([
      findOfflineActors(prisma),
      listQueuedItemsOnInactiveKitchens(prisma)
    ]);

    return ok({
      serverTime: new Date().toISOString(),
      offlineActors,
      inactiveKitchenQueuedItems
    });
  } catch (error) {
    return fail(error);
  }
}


