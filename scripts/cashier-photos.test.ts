import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { attachCashierPhoto, ignorePhotoStorageToday, requirePhotoStorageAvailable } from "../lib/domain/cashier-photos";
import { jpegDimensions, photoOverrideActive } from "../lib/cashier-photo-policy";
import { storeCashierPhoto, signCashierPhoto } from "../lib/server/cashier-photo-storage";

function fixture() {
  const state = { failedAt: null as Date | null, failureCode: null as string | null, ignoreUntil: null as Date | null };
  const photo = { id: "photo", actorId: "pos", checkoutKey: "checkout-key", capturedAt: new Date(), sha256: "abc", storedAt: new Date() as Date | null, failureCode: null as string | null, orderId: null as string | null, waivedAt: null as Date | null };
  const audits: any[] = [];
  const tx = {
    $queryRaw: async () => [],
    photoStorageState: { upsert: async () => state, findUniqueOrThrow: async () => state, update: async ({ data }: any) => Object.assign(state, data) },
    cashierPhoto: { findUnique: async () => photo, updateMany: async ({ where, data }: any) => {
      if (photo.orderId !== where.orderId) return { count: 0 };
      Object.assign(photo, data); return { count: 1 };
    } },
    auditLog: { findFirst: async () => null, create: async ({ data }: any) => { audits.push(data); return data; } },
  } as any;
  return { state, photo, audits, tx };
}

async function main() {
  assert.deepEqual(jpegDimensions(Uint8Array.from([255,216,255,192,0,17,8,1,224,2,128,3,1,17,0,2,17,0,3,17,0,255,217])), { width: 640, height: 480 });
  assert.equal(jpegDimensions(new Uint8Array(0)), null);
  assert.equal(jpegDimensions(Uint8Array.from([255,216,255,192,255,255,8,0,0,255,217])), null);
  assert.equal(jpegDimensions(Uint8Array.from([255,216,0,0,255,217])), null);
  assert.equal(photoOverrideActive(new Date("2026-10-28T15:00:00Z"), new Date("2026-10-28T14:59:59.999Z")), true);
  assert.equal(photoOverrideActive(new Date("2026-10-28T15:00:00Z"), new Date("2026-10-28T15:00:00Z")), false);
  assert.equal(photoOverrideActive(null), false);

  const stored = fixture();
  await attachCashierPhoto(stored.tx, { checkoutKey: "checkout-key", actorId: "pos", orderId: "order" });
  assert.equal(stored.photo.orderId, "order");
  await attachCashierPhoto(stored.tx, { checkoutKey: "checkout-key", actorId: "pos", orderId: "order" });
  await assert.rejects(attachCashierPhoto(stored.tx, { checkoutKey: "checkout-key", actorId: "other-pos", orderId: "order" }), { code: "CASHIER_PHOTO_REQUIRED" });
  await assert.rejects(attachCashierPhoto(stored.tx, { checkoutKey: "checkout-key", actorId: "pos", orderId: "another-order" }), { code: "CASHIER_PHOTO_BOUND" });

  const failed = fixture();
  failed.state.failedAt = new Date(); failed.state.failureCode = "PHOTO_STORAGE_UNAVAILABLE";
  failed.photo.storedAt = null; failed.photo.failureCode = "PHOTO_STORAGE_UNAVAILABLE";
  await assert.rejects(requirePhotoStorageAvailable(failed.tx), { code: "PHOTO_STORAGE_BLOCKED" });
  await assert.rejects(attachCashierPhoto(failed.tx, { checkoutKey: "checkout-key", actorId: "pos", orderId: "order" }), { code: "PHOTO_STORAGE_BLOCKED" });
  await ignorePhotoStorageToday(failed.tx, "admin", new Date("2026-10-28T14:59:59Z"));
  assert.equal(failed.state.ignoreUntil?.toISOString(), "2026-10-28T15:00:00.000Z");
  assert.equal(failed.audits[0].actionType, "PHOTO_STORAGE_FAILURE_DISMISSED");
  assert.equal(failed.audits[0].actorType, "ADMIN");
  assert.equal(failed.audits[0].afterJson.jstDate, "2026-10-28");
  failed.state.ignoreUntil = new Date(Date.now() + 60_000);
  await requirePhotoStorageAvailable(failed.tx);
  await attachCashierPhoto(failed.tx, { checkoutKey: "checkout-key", actorId: "pos", orderId: "order" });
  assert(failed.photo.waivedAt);
  assert.equal(failed.audits[1].actionType, "CASHIER_PHOTO_STORAGE_SKIPPED");
  assert.equal(failed.audits[1].orderId, "order");
  failed.state.ignoreUntil = new Date(Date.now() - 1);
  await assert.rejects(requirePhotoStorageAvailable(failed.tx), { code: "PHOTO_STORAGE_BLOCKED" });

  const noCamera = fixture();
  noCamera.state.ignoreUntil = new Date(Date.now() + 60_000);
  noCamera.photo.capturedAt = null as any;
  await assert.rejects(attachCashierPhoto(noCamera.tx, { checkoutKey: "checkout-key", actorId: "pos", orderId: "order" }), { code: "CASHIER_PHOTO_REQUIRED" });
  const healthy = fixture();
  await assert.rejects(ignorePhotoStorageToday(healthy.tx, "admin"), { code: "PHOTO_STORAGE_NOT_FAILED" });
  const midnight = fixture(); midnight.state.failedAt = new Date();
  await ignorePhotoStorageToday(midnight.tx, "admin", new Date("2026-10-28T15:00:00Z"));
  assert.equal(midnight.state.ignoreUntil?.toISOString(), "2026-10-29T15:00:00.000Z");

  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";
    process.env.SUPABASE_JWT_SECRET = "test-secret";
    process.env.CASHIER_PHOTO_BUCKET = "cashier-photos-test";
    const bytes = Uint8Array.from([1,2,3]);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: any, init: any) => { calls.push({ url: String(url), init }); return new Response("{}", { status: 200 }); }) as any;
    await storeCashierPhoto("0199facc-4321-4321-8321-012345678901.jpg", bytes, digest);
    assert.equal((calls[0].init.headers as any)["x-upsert"], "false");
    assert.equal(calls[0].init.method, "POST");
    const claims = JSON.parse(Buffer.from((calls[0].init.headers as any).Authorization.split(".")[1], "base64url").toString());
    assert.equal(claims.cashier_photo_path, "0199facc-4321-4321-8321-012345678901.jpg");
    assert.equal(claims.cashier_photo_action, "insert");
    assert.equal(claims.cashier_photo_bucket, "cashier-photos-test");
    assert.equal(claims.exp - claims.iat, 60);

    let attempt = 0;
    globalThis.fetch = (async () => ++attempt === 1 ? new Response("{}", { status: 409 }) : new Response(bytes)) as any;
    await storeCashierPhoto("image.jpg", bytes, digest);
    assert.equal(attempt, 2, "Lost upload response is recovered by hash without replacement");
    attempt = 0;
    globalThis.fetch = (async () => ++attempt === 1 ? new Response("{}", { status: 409 }) : new Response("different image")) as any;
    await assert.rejects(storeCashierPhoto("image.jpg", bytes, digest), { code: "PHOTO_STORAGE_UNAVAILABLE" });
    globalThis.fetch = (async (_: any, init: any) => {
      assert.equal(JSON.parse(init.body).expiresIn, 60);
      return Response.json({ signedURL: "/object/sign/test/image.jpg?token=test" });
    }) as any;
    assert.equal(await signCashierPhoto("image.jpg"), "https://example.supabase.co/storage/v1/object/sign/test/image.jpg?token=test");
  } finally { globalThis.fetch = originalFetch; process.env = originalEnv; }
  console.log("Cashier photo policy, JST override, actor binding, mandatory capture, audit records, immutable upload recovery, scoped JWT, and signed viewing passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
