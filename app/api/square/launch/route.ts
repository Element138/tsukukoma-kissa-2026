import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { assert } from "@/lib/errors";
import { createSquareAppSwitchRequest, squareConfig } from "@/lib/domain/square";
import { writeAuditLog } from "@/lib/domain/audit";
import { parseJson } from "@/lib/server/http";
import { squareBrowserFailure } from "@/lib/server/square-browser";
import { attachCashierPhoto, attachCashierPhotoBestEffort, requirePhotoStorageAvailable } from "@/lib/domain/cashier-photos";

export async function POST(req: NextRequest) {
  const isJson = req.headers.get("content-type")?.includes("application/json");
  try {
    const actor = await requireSession(req, { actorTypes: ["POS"] });
    squareConfig(req.nextUrl.origin);
    assert(req.headers.get("origin") === req.nextUrl.origin, 403, "FORBIDDEN", "同一サイトから操作してください");
    const body = isJson ? await parseJson(req, z.object({ orderId: z.string().min(1).max(128), cashierPhotoBestEffort: z.boolean().optional() })) : await req.formData();
    const orderId = body instanceof FormData ? body.get("orderId") : body.orderId;
    const bestEffortPhoto = body instanceof FormData ? body.get("cashierPhotoBestEffort") === "true" : body.cashierPhotoBestEffort === true;
    assert(typeof orderId === "string", 400, "ORDER_ID_REQUIRED", "注文IDが必要です");
    const deepLink = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const attempt = await tx.squarePaymentAttempt.findUnique({ where: { orderId }, include: { order: true } });
      assert(attempt && attempt.order.createdByActorId === actor.actorId, 404, "ORDER_NOT_FOUND", "注文が見つかりません");
      assert(!attempt.launchedAt && !attempt.resolvedAt && attempt.order.paymentStatus === "AWAITING", 409,
        "SQUARE_ALREADY_LAUNCHED", "決済開始済みです。Squareアプリに手動で戻り、元の決済を確認してください。再決済しないでください");
      if (!bestEffortPhoto) await requirePhotoStorageAvailable(tx);
      assert(attempt.order.idempotencyKey, 409, "CASHIER_PHOTO_REQUIRED", "この注文の会計者画像を撮影できません");
      await (bestEffortPhoto ? attachCashierPhotoBestEffort : attachCashierPhoto)(tx, { checkoutKey: attempt.order.idempotencyKey, actorId: actor.actorId, orderId });
      const link = createSquareAppSwitchRequest({
        orderId, orderNo: attempt.order.orderNo, amountJpy: attempt.order.totalPriceJpy,
        appId: attempt.appId, locationId: attempt.locationId, callbackUrl: attempt.callbackUrl, state: attempt.stateToken,
      }).deepLink;
      await tx.squarePaymentAttempt.update({ where: { id: attempt.id }, data: { launchedAt: new Date() } });
      await writeAuditLog(tx, { actorId: actor.actorId, actorType: actor.actorType,
        actionType: "SQUARE_LAUNCH", entityType: "order", entityId: orderId, orderId, result: "SUCCESS" });
      return link;
    });
    if (isJson) return ok({ deepLink }, { headers: { "Cache-Control": "no-store" } });
    const response = NextResponse.redirect(deepLink, 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) { return isJson ? fail(error) : squareBrowserFailure(); }
}
