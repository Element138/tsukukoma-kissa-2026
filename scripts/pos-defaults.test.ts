import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { posDefaultOnSession } from "../lib/domain/pos-default";
import { actorCreateSchema, actorUpdateSchema } from "../lib/validation";
import { renderPublicWaitTime } from "../lib/server/public-wait-time-html";

test("terminal defaults initialize correctly, preserve overrides on polling, and protect active carts", () => {
  assert.equal(posDefaultOnSession(null, "pos2", "TAKEOUT", false), "TAKEOUT");
  assert.equal(posDefaultOnSession(null, "pos1", "DINE_IN", false), "DINE_IN");
  assert.equal(posDefaultOnSession("pos2:TAKEOUT", "pos2", "TAKEOUT", false), null);
  assert.equal(posDefaultOnSession("pos2:TAKEOUT", "pos2", "DINE_IN", true), null);
  assert.equal(posDefaultOnSession(null, "pos2", "TAKEOUT", true), null);
  assert.equal(posDefaultOnSession("pos2:TAKEOUT", "pos2", "DINE_IN", false), "DINE_IN");
});

test("actor input validates fulfillment enum and restricts create configuration to POS", () => {
  assert.equal(actorCreateSchema.parse({ actorType: "POS", label: "POS4", secret: "abcd", defaultFulfillmentType: "TAKEOUT" }).defaultFulfillmentType, "TAKEOUT");
  assert.equal(actorCreateSchema.safeParse({ actorType: "KITCHEN", label: "Kitchen", secret: "abcd", defaultFulfillmentType: "TAKEOUT" }).success, false);
  assert.equal(actorUpdateSchema.safeParse({ id: "pos2", defaultFulfillmentType: "invalid" }).success, false);
});

test("admin PATCH persists default, audits it, rejects non-POS settings and non-admin callers", async () => {
  let actorType = "POS", role = "ADMIN";
  let saved = "DINE_IN";
  const audits: any[] = [];
  const source = readFileSync(new URL("../app/api/admin/actors/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} as { PATCH: (req: unknown) => Promise<any> } };
  class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
  const db = { actor: {
    findUnique: async () => ({ id: "pos2", actorType, label: "POS2", defaultFulfillmentType: saved }),
    update: async ({ data }: any) => { saved = data.defaultFulfillmentType ?? saved; return { id: "pos2", actorType, label: "POS2", defaultFulfillmentType: saved }; },
  } };
  vm.runInNewContext(compiled, { exports: module.exports, module, console, Date,
    require: (name: string) => {
      if (name === "node:crypto") return { randomUUID: () => "unused" };
      if (name === "next/server") return {};
      if (name === "@/lib/db") return { prisma: { $transaction: (fn: any) => fn(db) } };
      if (name === "@/lib/server/auth") return { requireSession: async () => { if (role !== "ADMIN") throw new ApiError(403, "FORBIDDEN", "Forbidden"); return { actorId: "admin", actorType: role }; } };
      if (name === "@/lib/response") return { ok: (value: any) => ({ status: 200, value }), fail: (e: any) => ({ status: e.status ?? 400, code: e.code }) };
      if (name === "@/lib/server/http") return { parseJson: async (req: any, schema: any) => schema.parse(await req.json()) };
      if (name === "@/lib/validation") return { actorCreateSchema, actorUpdateSchema };
      if (name === "@/lib/crypto") return { hashSecret: () => "unused" };
      if (name === "@/lib/domain/audit") return { writeAuditLog: async (_: any, value: any) => audits.push(value) };
      if (name === "@/lib/domain/kitchen-assignment") return {};
      if (name === "@/lib/server/queries") return {};
      if (name === "@/lib/server/trace") return { withRouteTrace: (_: any, _name: string, fn: any) => fn(() => {}), traceError: () => {} };
      if (name === "@/lib/errors") return { AppError: ApiError };
      if (name === "@/lib/server/realtime-broadcast") return { broadcastInvalidation: async () => {}, CHANNEL_GROUPS: { ACTORS: ["actors"] } };
      throw new Error(name);
    },
  });
  const req = { json: async () => ({ id: "pos2", defaultFulfillmentType: "TAKEOUT" }) };
  assert.equal((await module.exports.PATCH(req)).status, 200);
  assert.equal(saved, "TAKEOUT");
  assert.equal(audits[0].beforeJson.defaultFulfillmentType, "DINE_IN");
  assert.equal(audits[0].afterJson.defaultFulfillmentType, "TAKEOUT");
  actorType = "KITCHEN";
  assert.equal((await module.exports.PATCH(req)).code, "INVALID_POS_FIELD");
  role = "POS";
  assert.equal((await module.exports.PATCH(req)).status, 403);
});

test("public heading uses the requested wording", () => {
  assert.match(renderPublicWaitTime(null), /<h1>ご注文からの待ち時間の目安<\/h1>/);
});
