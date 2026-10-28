import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { assert, AppError } from "@/lib/errors";
import { ok, fail } from "@/lib/response";
import { CASHIER_PHOTO_MAX_BYTES, CASHIER_PHOTO_FRESH_MS, jpegDimensions, photoOverrideActive } from "@/lib/cashier-photo-policy";
import { photoStorageState } from "@/lib/domain/cashier-photos";
import { storeCashierPhoto } from "@/lib/server/cashier-photo-storage";
import { writeAuditLog } from "@/lib/domain/audit";
import { broadcastInvalidation } from "@/lib/server/realtime-broadcast";

export const maxDuration = 30;

async function readImage(req: NextRequest) {
  assert(req.headers.get("content-type") === "image/jpeg", 415, "PHOTO_TYPE", "JPEG画像が必要です");
  const reader = req.body?.getReader();
  assert(reader, 400, "PHOTO_REQUIRED", "会計者画像が必要です");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      assert(size <= CASHIER_PHOTO_MAX_BYTES, 413, "PHOTO_TOO_LARGE", "画像は100 KB以下にしてください");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = Buffer.concat(chunks);
  const dimensions = jpegDimensions(bytes);
  assert(dimensions && dimensions.width >= 160 && dimensions.height >= 120 && dimensions.width <= 1280 && dimensions.height <= 1280,
    400, "PHOTO_INVALID", "撮影した画像を確認できません。もう一度撮影してください");
  return bytes;
}

export async function POST(req: NextRequest, context: { params: Promise<{ photoId: string }> }) {
  try {
    const actor = await requireSession(req, { actorTypes: ["POS"] });
    assert(req.headers.get("origin") === req.nextUrl.origin, 403, "FORBIDDEN", "同一サイトから操作してください");
    const { photoId } = await context.params;
    const owner = await prisma.cashierPhoto.findUnique({ where: { id: photoId } });
    assert(owner?.actorId === actor.actorId, 404, "PHOTO_NOT_FOUND", "会計者画像が見つかりません");
    const bytes = await readImage(req);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "CashierPhoto" WHERE id = ${photoId} FOR UPDATE`;
      const photo = await tx.cashierPhoto.findUniqueOrThrow({ where: { id: photoId } });
      const state = await photoStorageState(tx);
      if (photo.storedAt) {
        assert(photo.sha256 === digest, 409, "PHOTO_FRAME_CHANGED", "保存済みの会計者画像は変更できません");
        return { photoId, stored: true, ignoreAllowed: photoOverrideActive(state.ignoreUntil) };
      }
      assert(!photo.orderId, 409, "CASHIER_PHOTO_BOUND", "登録済みの会計者画像は変更できません");
      assert(photo.sessionId === actor.sessionId, 409, "PHOTO_SESSION_CHANGED", "ログイン後にもう一度撮影してください");
      assert(photo.capturedAt || Date.now() - photo.requestedAt.getTime() < CASHIER_PHOTO_FRESH_MS,
        409, "PHOTO_EXPIRED", "撮影の有効時間を過ぎました。もう一度撮影してください");
      // A retry uses the same key for the same frame. A new frame after an
      // unsuccessful attempt gets a distinct immutable object, never an upsert.
      const objectPath = `${photo.id}/${digest}.jpg`;
      const capturedAt = photo.sha256 === digest && photo.capturedAt ? photo.capturedAt : new Date();
      let failureCode: string | null = null;
      try { await storeCashierPhoto(objectPath, bytes, digest); }
      catch (error) { failureCode = error instanceof AppError ? error.code : "PHOTO_STORAGE_UNAVAILABLE"; }
      await tx.cashierPhoto.update({ where: { id: photoId }, data: {
        objectPath, sha256: digest, byteSize: bytes.length, capturedAt,
        storedAt: failureCode ? null : new Date(), failureCode,
      } });
      await tx.photoStorageState.update({ where: { id: 1 }, data: { failedAt: failureCode ? new Date() : null, failureCode } });
      if (failureCode && !state.failedAt) await writeAuditLog(tx, {
        actorId: actor.actorId, actorType: "POS", actionType: "PHOTO_STORAGE_FAILED", entityType: "photo_storage", entityId: "1",
        result: "FAILURE", reasonType: failureCode,
      });
      await broadcastInvalidation(tx, ["orders", "audit"], "photo_storage", failureCode ? "photo_storage_failed" : "photo_storage_restored");
      return { photoId, stored: !failureCode, ignoreAllowed: photoOverrideActive(state.ignoreUntil) };
    }, { timeout: 25_000 });
    return ok(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
