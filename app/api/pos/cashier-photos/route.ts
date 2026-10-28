import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { assert } from "@/lib/errors";
import { ok, fail } from "@/lib/response";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["POS"] });
    assert(req.headers.get("origin") === req.nextUrl.origin, 403, "FORBIDDEN", "同一サイトから操作してください");
    const { checkoutKey } = await parseJson(req, z.object({ checkoutKey: z.string().min(8).max(128) }));
    const photo = await prisma.$transaction(async tx => {
      const existing = await tx.cashierPhoto.findUnique({ where: { checkoutKey } });
      if (existing) {
        assert(existing.actorId === actor.actorId, 403, "FORBIDDEN", "この会計者画像は使用できません");
        if (!existing.storedAt && !existing.orderId) return tx.cashierPhoto.update({
          where: { id: existing.id }, data: { sessionId: actor.sessionId, ...(!existing.capturedAt ? { requestedAt: new Date() } : {}) },
        });
        return existing;
      }
      const count = await tx.cashierPhoto.count({ where: { actorId: actor.actorId, requestedAt: { gte: new Date(Date.now() - 60_000) } } });
      assert(count < 10, 429, "PHOTO_RATE_LIMIT", "少し待ってから撮影してください");
      return tx.cashierPhoto.create({ data: { checkoutKey, actorId: actor.actorId, sessionId: actor.sessionId } });
    });
    return ok({ photoId: photo.id, stored: Boolean(photo.storedAt), captured: Boolean(photo.capturedAt) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
