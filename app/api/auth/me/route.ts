import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { prisma } from "@/lib/db";
import { findOfflineActors, listQueuedItemsOnInactiveKitchens } from "@/lib/server/queries";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireSession(req);

    const [offlineActors, inactiveKitchenQueuedItems] = await Promise.all([
      findOfflineActors(prisma),
      listQueuedItemsOnInactiveKitchens(prisma)
    ]);

    return ok({
      actor,
      offlineActors,
      inactiveKitchenQueuedItems
    });
  } catch (error) {
    return fail(error);
  }
}


