import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { assert } from "@/lib/errors";
import { fail, ok } from "@/lib/response";
import { reconcileSquarePayment } from "@/lib/domain/square-payments";

export const maxDuration = 30;
export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["POS", "ADMIN"] });
    assert(req.headers.get("origin") === req.nextUrl.origin, 403, "FORBIDDEN", "同一サイトから操作してください");
    const { orderId } = await parseJson(req, z.object({ orderId: z.string().min(1).max(128) }));
    const attempt = await prisma.squarePaymentAttempt.findUnique({ where: { orderId }, include: { order: true } });
    assert(attempt && (actor.actorType === "ADMIN" || attempt.order.createdByActorId === actor.actorId), 404, "ORDER_NOT_FOUND", "注文が見つかりません");
    assert(new URL(attempt.callbackUrl).origin === req.nextUrl.origin, 403, "FORBIDDEN", "登録済みの本番URLから操作してください");
    return ok(await reconcileSquarePayment(prisma, orderId));
  } catch (error) { return fail(error); }
}
