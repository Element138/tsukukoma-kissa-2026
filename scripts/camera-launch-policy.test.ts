import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { AppError, assert as appAssert } from "../lib/errors";
import * as photos from "../lib/domain/cashier-photos";

function launchFixture(role: string | null = "POS", owner = "pos", launched = false) {
  const audit: any[] = [];
  let launches = 0;
  const attempt: any = { id: "attempt", launchedAt: launched ? new Date() : null, resolvedAt: null,
    order: { createdByActorId: owner, paymentStatus: "AWAITING", idempotencyKey: "checkout-key", orderNo: 479, totalPriceJpy: 550 } };
  const tx: any = {
    $queryRaw: async () => [], cashierPhoto: { findUnique: async () => null },
    photoStorageState: { upsert: async () => ({ failedAt: new Date(), ignoreUntil: null }) },
    squarePaymentAttempt: { findUnique: async () => attempt, update: async () => { launches++; } },
    auditLog: { findFirst: async () => null, create: async ({ data }: any) => { audit.push(data); return data; } },
  };
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { redirect: (url: string, status: number) => new Response(null, { status, headers: { Location: url } }) } },
    zod: { z }, "@/lib/db": { prisma: { $transaction: (work: any) => work(tx) } },
    "@/lib/server/auth": { requireSession: async (_req: unknown, options: { actorTypes: string[] }) => {
      if (!role) throw new AppError(401, "UNAUTHORIZED", "Login required");
      if (!options.actorTypes.includes(role)) throw new AppError(403, "FORBIDDEN", "POS required");
      return { actorId: "pos", actorType: role };
    } },
    "@/lib/response": { ok: (data: unknown) => Response.json({ ok: true, data }), fail: (error: any) => Response.json({ code: error.code }, { status: error.status ?? 500 }) },
    "@/lib/errors": { assert: appAssert },
    "@/lib/domain/square": { squareConfig: () => ({}), createSquareAppSwitchRequest: () => ({ deepLink: "square-commerce-v1://payment/create?data=mock" }) },
    "@/lib/domain/audit": { writeAuditLog: async (_tx: unknown, input: unknown) => { audit.push(input); } },
    "@/lib/server/http": { parseJson: async (req: Request, schema: any) => schema.parse(await req.json()) },
    "@/lib/server/square-browser": { squareBrowserFailure: () => new Response(null, { status: 400 }) },
    "@/lib/domain/cashier-photos": photos,
  };
  const exports: any = {};
  const source = readFileSync(new URL("../app/api/square/launch/route.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: (id: string) => { if (!(id in modules)) throw new Error(`Unexpected import: ${id}`); return modules[id]; }, FormData,
  });
  const request = (bestEffort?: boolean, form = false) => {
    const data = new FormData(); data.set("orderId", "order"); if (bestEffort !== undefined) data.set("cashierPhotoBestEffort", String(bestEffort));
    const req: any = new Request("https://example.test/api/square/launch", { method: "POST", headers: { Origin: "https://example.test", ...(form ? {} : { "Content-Type": "application/json" }) },
      body: form ? data : JSON.stringify({ orderId: "order", cashierPhotoBestEffort: bestEffort }) });
    req.nextUrl = new URL(req.url); return req;
  };
  return { post: exports.POST, request, audit, get launches() { return launches; } };
}

test("authenticated POS can launch without a photo through JSON and native form handoff", async () => {
  for (const form of [false, true]) {
    const f = launchFixture();
    const response = await f.post(f.request(true, form));
    assert.equal(response.status, form ? 303 : 200);
    assert.equal(f.launches, 1);
    assert(f.audit.some(row => row.actionType === "CASHIER_PHOTO_SKIPPED"));
    assert(f.audit.some(row => row.actionType === "SQUARE_LAUNCH"));
  }
});

test("best-effort flag cannot bypass login, POS role, order ownership or one-time launch", async () => {
  for (const [role, owner, launched, status] of [[null, "pos", false, 401], ["WAITER", "pos", false, 403], ["POS", "other-pos", false, 404], ["POS", "pos", true, 409]] as const) {
    const f = launchFixture(role, owner, launched);
    assert.equal((await f.post(f.request(true))).status, status);
    assert.equal(f.launches, 0);
  }
});

test("strict callers retain the photo-storage gate unless they explicitly opt in", async () => {
  for (const option of [undefined, false]) {
    const f = launchFixture();
    assert.equal((await f.post(f.request(option))).status, 503);
    assert.equal(f.launches, 0);
  }
});
