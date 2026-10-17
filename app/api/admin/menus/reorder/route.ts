import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { reorderMenu } from "@/lib/domain/menu-order";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";
import { fail, ok } from "@/lib/response";

const schema = z.object({ menuId: z.string().uuid(), direction: z.union([z.literal(-1), z.literal(1)]) });

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
    const body = await parseJson(req, schema);
    const result = await prisma.$transaction(async tx => {
      const result = await reorderMenu(tx, { ...body, actorId: actor.actorId });
      if (result.changed) await broadcastInvalidation(tx, CHANNEL_GROUPS.MENUS, "menus", "menu_reordered");
      return result;
    });
    return ok(result);
  } catch (error) { return fail(error); }
}
