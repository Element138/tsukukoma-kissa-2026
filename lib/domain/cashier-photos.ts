import { Prisma } from "@prisma/client";
import { assert } from "@/lib/errors";
import { photoOverrideActive } from "@/lib/cashier-photo-policy";
import { tokyoDayRangeUtc } from "@/lib/time";
import { writeAuditLog } from "@/lib/domain/audit";

export async function photoStorageState(tx: Prisma.TransactionClient) {
  return tx.photoStorageState.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export async function requirePhotoStorageAvailable(tx: Prisma.TransactionClient) {
  const state = await photoStorageState(tx);
  assert(!state.failedAt || photoOverrideActive(state.ignoreUntil), 503, "PHOTO_STORAGE_BLOCKED", "画像を保存できないため新規会計を停止しています。管理者に確認してください");
}

export async function attachCashierPhoto(tx: Prisma.TransactionClient, input: {
  checkoutKey: string; actorId: string; orderId: string;
}) {
  const photo = await tx.cashierPhoto.findUnique({ where: { checkoutKey: input.checkoutKey } });
  assert(photo && photo.actorId === input.actorId && photo.capturedAt && photo.sha256, 409, "CASHIER_PHOTO_REQUIRED", "会計者画像の撮影が必要です");
  if (photo.orderId === input.orderId) return photo;
  assert(!photo.orderId, 409, "CASHIER_PHOTO_BOUND", "この会計者画像は登録済みです");
  const state = await photoStorageState(tx);
  const waived = !photo.storedAt && Boolean(photo.failureCode) && photoOverrideActive(state.ignoreUntil);
  assert(photo.storedAt || waived, 503, "PHOTO_STORAGE_BLOCKED", "画像を保存できないため新規会計を停止しています。管理者に確認してください");
  const bound = await tx.cashierPhoto.updateMany({
    where: { id: photo.id, orderId: null }, data: { orderId: input.orderId, waivedAt: waived ? new Date() : null },
  });
  assert(bound.count === 1, 409, "CASHIER_PHOTO_BOUND", "この会計者画像は登録済みです");
  if (waived) await writeAuditLog(tx, {
    actorId: input.actorId, actorType: "POS", actionType: "CASHIER_PHOTO_STORAGE_SKIPPED", entityType: "order",
    entityId: input.orderId, orderId: input.orderId, result: "SUCCESS",
    afterJson: { photoId: photo.id, sha256: photo.sha256, failureCode: photo.failureCode, ignoreUntil: state.ignoreUntil?.toISOString() },
  });
  return photo;
}

export async function ignorePhotoStorageToday(tx: Prisma.TransactionClient, adminId: string, at = new Date()) {
  await photoStorageState(tx);
  await tx.$queryRaw`SELECT id FROM "PhotoStorageState" WHERE id = 1 FOR UPDATE`;
  const state = await tx.photoStorageState.findUniqueOrThrow({ where: { id: 1 } });
  assert(state.failedAt, 409, "PHOTO_STORAGE_NOT_FAILED", "保存失敗は報告されていません");
  const { dateKey, end } = tokyoDayRangeUtc(at);
  const updated = await tx.photoStorageState.update({ where: { id: 1 }, data: { ignoreUntil: end } });
  await writeAuditLog(tx, {
    actorId: adminId, actorType: "ADMIN", actionType: "PHOTO_STORAGE_FAILURE_DISMISSED", entityType: "photo_storage",
    entityId: "1", result: "SUCCESS", beforeJson: { ignoreUntil: state.ignoreUntil?.toISOString() ?? null },
    afterJson: { jstDate: dateKey, ignoreUntil: end.toISOString(), failureCode: state.failureCode },
  });
  return updated;
}
