import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parse } from "dotenv";
import { NextRequest } from "next/server";
import sharp from "sharp";

async function main() {
  Object.assign(process.env, parse(readFileSync(".env.local")), { KISSA_TRACE_DB: "0", SUPABASE_JWT_SECRET: "integration-test-only" });
  assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get("schema"), "kissa_cashier_photo_preview", "Integration tests require the isolated Preview schema");
  const { prisma } = await import("../lib/db");
  const { createSession } = await import("../lib/server/auth");
  const { hashSecret } = await import("../lib/crypto");
  const challenge = await import("../app/api/pos/cashier-photos/route");
  const upload = await import("../app/api/pos/cashier-photos/[photoId]/route");
  const checkout = await import("../app/api/orders/route");
  const storage = await import("../app/api/admin/photo-storage/route");
  const view = await import("../app/api/orders/[orderId]/cashier-photo/route");
  const { ignorePhotoStorageToday } = await import("../lib/domain/cashier-photos");
  const prefix = `photo-test-${randomUUID().slice(0, 8)}`;
  const actorIds = ["POS", "ADMIN", "WAITER", "KITCHEN"].map(role => `${prefix}-${role}`);
  const tokens: Record<string, string> = {};
  const keys: string[] = [];
  const orderIds: string[] = [];
  const oldState = await prisma.photoStorageState.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const originalFetch = globalThis.fetch;
  let failing = false;
  const objects = new Map<string, Uint8Array>();
  globalThis.fetch = (async (url: any, init: any) => {
    assert(String(url).startsWith(process.env.NEXT_PUBLIC_SUPABASE_URL!), "Only the Storage boundary may be mocked");
    if (failing) return new Response("unavailable", { status: 503 });
    if (String(url).includes("/object/sign/")) return Response.json({ signedURL: "/object/sign/test/image.jpg?token=test" });
    if (init.method === "POST") {
      if (objects.has(String(url))) return new Response("conflict", { status: 409 });
      objects.set(String(url), new Uint8Array(init.body)); return Response.json({ Key: "stored" });
    }
    return new Response("not found", { status: 404 });
  }) as any;
  const req = (path: string, role: string | null, body?: unknown, mime = "application/json", origin = "http://localhost:3117") => new NextRequest(`http://localhost:3117${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: origin, "Content-Type": mime, ...(role ? { Cookie: `kissa_session=${tokens[role]}` } : {}) },
    ...(body === undefined ? {} : { body: mime === "image/jpeg" ? new Uint8Array(body as Uint8Array).buffer : JSON.stringify(body) }),
  });
  const newPhoto = async () => {
    const key = `${prefix}-${randomUUID()}`; keys.push(key);
    const response = await challenge.POST(req("/api/pos/cashier-photos", "POS", { checkoutKey: key }));
    assert.equal(response.status, 200);
    return { key, id: (await response.json()).data.photoId as string };
  };
  let categoryId: string | undefined;
  let menuId: string | undefined;
  try {
    for (const [index, role] of ["POS", "ADMIN", "WAITER", "KITCHEN"].entries()) {
      await prisma.actor.create({ data: { id: actorIds[index], actorType: role as any, label: "Photo integration test", secretHash: hashSecret(randomUUID()) } });
      tokens[role] = (await createSession({ id: actorIds[index], actorType: role as any })).token;
    }
    await prisma.photoStorageState.update({ where: { id: 1 }, data: { failedAt: null, failureCode: null, ignoreUntil: null } });
    categoryId = (await prisma.menuCategory.create({ data: { name: prefix } })).id;
    menuId = (await prisma.menu.create({ data: { name: prefix, priceJpy: 500, workloadSeconds: 1, categoryId } })).id;
    await prisma.menuKitchenAssignment.create({ data: { menuId, kitchenId: actorIds[3] } });
    const payload = (key: string) => ({ fulfillmentType: "TAKEOUT", partySize: 1, ageRanges: ["20s"], paymentMethod: "CASH", items: [{ menuId, quantity: 1 }], idempotencyKey: key });
    const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#447766" } }).jpeg().toBuffer();
    const different = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#887744" } }).jpeg().toBuffer();
    assert.equal((await challenge.POST(req("/api/pos/cashier-photos", null, { checkoutKey: "anonymous" }))).status, 401);
    assert.equal((await storage.POST(req("/api/admin/photo-storage", "POS", { confirm: true }))).status, 403);
    assert.equal((await challenge.POST(req("/api/pos/cashier-photos", "POS", { checkoutKey: "cross-origin" }, "application/json", "https://evil.example"))).status, 403);
    const first = await newPhoto();
    const context = { params: Promise.resolve({ photoId: first.id }) };
    assert.equal((await upload.POST(req("/upload", "WAITER", jpeg, "image/jpeg"), context)).status, 403);
    assert.equal((await upload.POST(req("/upload", "POS", Buffer.alloc(100001), "image/jpeg"), context)).status, 413);
    const saved = await upload.POST(req("/upload", "POS", jpeg, "image/jpeg"), context);
    assert.equal(saved.status, 200); assert.equal((await saved.json()).data.stored, true);
    const created = await checkout.POST(req("/api/orders", "POS", payload(first.key)));
    const createdBody = await created.json();
    assert.equal(created.status, 200, JSON.stringify(createdBody));
    const orderId = createdBody.data.order.id; orderIds.push(orderId);
    assert.equal(createdBody.data.order.paymentStatus, "PAID");
    assert.equal((await prisma.cashierPhoto.findUniqueOrThrow({ where: { id: first.id } })).orderId, orderId);
    const duplicate = await checkout.POST(req("/api/orders", "POS", payload(first.key)));
    assert.equal((await duplicate.json()).data.order.id, orderId);
    assert.equal((await upload.POST(req("/upload", "POS", different, "image/jpeg"), context)).status, 409);
    assert.equal(objects.size, 1);
    assert.equal((await view.GET(req("/view", null), { params: Promise.resolve({ orderId }) })).status, 401);
    const viewed = await view.GET(req("/view", "WAITER"), { params: Promise.resolve({ orderId }) });
    assert.equal(viewed.status, 200); assert((await viewed.json()).data.url);

    failing = true;
    const second = await newPhoto();
    const context2 = { params: Promise.resolve({ photoId: second.id }) };
    const failed = await upload.POST(req("/upload", "POS", jpeg, "image/jpeg"), context2);
    const failedBody = await failed.json();
    assert.equal(failedBody.data.stored, false); assert.equal(failedBody.data.ignoreAllowed, false);
    assert.equal((await checkout.POST(req("/api/orders", "POS", payload(second.key)))).status, 503);
    assert.equal(await prisma.order.count({ where: { idempotencyKey: second.key } }), 0);
    assert.equal((await storage.GET(req("/api/admin/photo-storage", "ADMIN"))).status, 200);
    // Failed audit insertion must roll back the permission in the real database.
    await assert.rejects(prisma.$transaction(tx => ignorePhotoStorageToday(tx, `${prefix}-missing-admin`)));
    assert.equal((await prisma.photoStorageState.findUniqueOrThrow({ where: { id: 1 } })).ignoreUntil, null);
    assert.equal((await storage.POST(req("/api/admin/photo-storage", "ADMIN", { confirm: true }))).status, 200);
    const resumed = await checkout.POST(req("/api/orders", "POS", payload(second.key)));
    const resumedBody = await resumed.json();
    assert.equal(resumed.status, 200, JSON.stringify(resumedBody)); orderIds.push(resumedBody.data.order.id);
    const waived = await prisma.cashierPhoto.findUniqueOrThrow({ where: { id: second.id } });
    assert(waived.waivedAt); assert.equal(waived.storedAt, null);
    const waivedView = await view.GET(req("/view", "ADMIN"), { params: Promise.resolve({ orderId: resumedBody.data.order.id }) });
    assert.equal((await waivedView.json()).data.url, null);
    const missingKey = `${prefix}-missing-capture`; keys.push(missingKey);
    assert.equal((await checkout.POST(req("/api/orders", "POS", payload(missingKey)))).status, 409, "Daily override does not bypass capture");
    assert.equal(await prisma.auditLog.count({ where: { actorId: actorIds[1], actionType: "PHOTO_STORAGE_FAILURE_DISMISSED" } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { orderId: resumedBody.data.order.id, actionType: "CASHIER_PHOTO_STORAGE_SKIPPED" } }), 1);
    await prisma.photoStorageState.update({ where: { id: 1 }, data: { ignoreUntil: new Date(Date.now() - 1) } });
    const third = await newPhoto();
    await upload.POST(req("/upload", "POS", jpeg, "image/jpeg"), { params: Promise.resolve({ photoId: third.id }) });
    assert.equal((await checkout.POST(req("/api/orders", "POS", payload(third.key)))).status, 503);
    console.log("Integration checks passed against isolated PostgreSQL: authenticated capture/upload/checkout/viewing, duplicate recovery, immutable images, failure stop, ADMIN-only daily override, audit rollback atomicity, per-order waiver records, mandatory capture and expiry. Only the external Storage HTTP boundary was mocked.");
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: actorIds } }, { orderId: { in: orderIds } }] } });
    await prisma.cashierPhoto.deleteMany({ where: { checkoutKey: { in: keys } } });
    await prisma.order.deleteMany({ where: { createdByActorId: actorIds[0] } });
    if (menuId) { await prisma.menuDailyCount.deleteMany({ where: { menuId } }); await prisma.menu.delete({ where: { id: menuId } }); }
    if (categoryId) await prisma.menuCategory.delete({ where: { id: categoryId } });
    await prisma.actor.deleteMany({ where: { id: { in: actorIds } } });
    await prisma.photoStorageState.update({ where: { id: 1 }, data: { failedAt: oldState.failedAt, failureCode: oldState.failureCode, ignoreUntil: oldState.ignoreUntil } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
