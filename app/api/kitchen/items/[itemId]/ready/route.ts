import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { itemReadySchema } from "@/lib/validation";
import { parseJson } from "@/lib/server/http";
import { markKitchenItemReady } from "@/lib/domain/kitchen";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest, context: { params: Promise<{ itemId: string }> }) {
  try {
    const actor = await requireSession(req, { actorTypes: ["KITCHEN"] });
    if (!actor.lineId) {
      throw new AppError(400, "LINE_REQUIRED", "Kitchen actor has no line assignment");
    }
    await parseJson(req, itemReadySchema);

    const { itemId } = await context.params;

    const result = await prisma.$transaction((tx) =>
      markKitchenItemReady(tx, {
        actorId: actor.actorId,
        lineId: actor.lineId!,
        itemId
      })
    );

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}


