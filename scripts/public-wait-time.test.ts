import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { predictPublicWaitTime, type WaitTimeAggregates } from "../lib/domain/public-wait-time";
import { renderPublicWaitTime } from "../lib/server/public-wait-time-html";
import { tokyoDayRangeUtc } from "../lib/time";
import { readWaitTimeSnapshot } from "../lib/domain/wait-time-snapshot";

const features: WaitTimeAggregates = {
  dineInCompleted: 10, takeoutCompleted: 10, queueItems: 20,
  queueAgeP90: 12, servedItems20: 20, servedItems60: 60,
  takeoutMean: 11, dispatchMargin: 3,
};

test("selected heads match their portable research versions before five-minute rounding", () => {
  // Dine-in 4 + .5 * 20 / 1 + .5 * 12 = 20; cautious takeout 11 + 3 = 14.
  assert.deepEqual(predictPublicWaitTime(features), { dineIn: 20, takeout: 15 });
  assert.equal(predictPublicWaitTime({ ...features, queueItems: 20.1 }).dineIn, 20);
  assert.equal(predictPublicWaitTime({ ...features, takeoutMean: 12 }).takeout, 15);
  assert.equal(predictPublicWaitTime({ ...features, takeoutMean: 12.01 }).takeout, 15);
  // Halfway values round upward; existing five-minute minimum is retained.
  assert.equal(predictPublicWaitTime({ ...features, takeoutMean: 9.49 }).takeout, 10);
  assert.equal(predictPublicWaitTime({ ...features, takeoutMean: 9.5 }).takeout, 15);
  assert.equal(predictPublicWaitTime({ ...features, takeoutMean: 14.49 }).takeout, 15);
  assert.equal(predictPublicWaitTime({ ...features, takeoutMean: 14.5 }).takeout, 20);
  assert.equal(predictPublicWaitTime({ ...features, takeoutMean: 0, dispatchMargin: 0 }).takeout, 5);
  assert.equal(predictPublicWaitTime({ ...features, dispatchMargin: null }).takeout, 15);
});

test("warmup is separate for each type, resets each JST day, and never invents an estimate", () => {
  assert.deepEqual(predictPublicWaitTime({ ...features, dineInCompleted: 9 }), { dineIn: null, takeout: 15 });
  assert.deepEqual(predictPublicWaitTime({ ...features, takeoutCompleted: 9 }), { dineIn: 20, takeout: null });
  assert.deepEqual(predictPublicWaitTime({ ...features, dineInCompleted: 0, takeoutCompleted: 0 }), { dineIn: null, takeout: null });
  assert.equal(predictPublicWaitTime({ ...features, takeoutMean: null }).takeout, null);
  assert.equal(predictPublicWaitTime({ ...features, queueAgeP90: NaN }).dineIn, null);
  assert.equal(tokyoDayRangeUtc(new Date("2026-10-31T15:00:00Z")).start.toISOString(), "2026-10-31T15:00:00.000Z");
  assert.equal(tokyoDayRangeUtc(new Date("2026-10-31T14:59:59Z")).start.toISOString(), "2026-10-30T15:00:00.000Z");
});

test("public document contains only the requested content and makes no asset or data requests", () => {
  const html = renderPublicWaitTime({ dineIn: 20, takeout: 15 });
  assert.match(html, /イートイン/);
  assert.match(html, /テイクアウト/);
  assert.match(html, /<strong>20<\/strong><span>分以上<\/span>/);
  assert.match(renderPublicWaitTime({ dineIn: 21, takeout: 22.5 }), /<strong>20<\/strong><span>分以上<\/span>[\s\S]*<strong>25<\/strong><span>分以上<\/span>/);
  assert.match(html, /お会計後の待ち時間の推定です。お並びになる時間は含んでおりません/);
  assert.match(html, /120;url=\/wait-time/);
  assert.doesNotMatch(html, /<script|<img|<button|<a\s|https?:|fullscreen|login|__NEXT/);
  assert.ok(Buffer.byteLength(html) < 4096);
  const unavailable = renderPublicWaitTime(null);
  assert.doesNotMatch(unavailable, /分以上/);
  assert.equal(unavailable.match(/現在、待ち時間を推定できません/g)?.length, 2);
});

test("40 public reloads only read one snapshot, never orders or model calculations", async () => {
  let queries = 0;
  let capturedSql = "";
  const source = readFileSync(new URL("../lib/server/public-wait-time.ts", import.meta.url), "utf8");
  const module = { exports: {} as { getPublicWaitTime: () => Promise<unknown> } };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, {
    exports: module.exports, module, console, Date, Map,
    require: (name: string) => {
      if (name === "next/cache") return { unstable_cache: (fn: unknown, keys: string[], options: { revalidate: number }) => {
        assert.deepEqual(Array.from(keys), ["public-wait-time-snapshot-v2"]);
        assert.equal(options.revalidate, 60);
        return fn; // Force cache misses to test the additional cold-start guard.
      } };
      if (name === "@/lib/db") return { prisma: { $queryRaw: async (strings: TemplateStringsArray) => {
        queries += 1; capturedSql = strings.join("?");
        await new Promise(resolve => setTimeout(resolve, 10));
        return [{ computedAt: new Date(), payload: { dineIn: 20, takeout: 15 } }];
      } } };
      if (name === "@/lib/time") return { tokyoDayRangeUtc };
      if (name === "@/lib/domain/public-wait-time") return { predictPublicWaitTime };
      if (name === "@/lib/domain/wait-time-snapshot") return { readWaitTimeSnapshot };
      throw new Error(name);
    },
  });
  const results = await Promise.all(Array.from({ length: 40 }, () => module.exports.getPublicWaitTime()));
  assert.equal(queries, 1);
  assert.ok(results.every(value => JSON.stringify(value) === JSON.stringify({ dineIn: 20, takeout: 15 })));
  await module.exports.getPublicWaitTime();
  assert.equal(queries, 1, "Sequential framework-cache bypasses must also reuse the warm-process result");
  assert.match(capturedSql, /SELECT "computedAt", payload FROM "PublicWaitTimeSnapshot" WHERE id = 1/);
  assert.doesNotMatch(capturedSql, /Order|OrderItem|OrderCall|INSERT|UPDATE/);
});

test("snapshots disappear after five minutes, on JST rollover, or if invalid", () => {
  const now = new Date("2026-11-01T03:00:00Z"), start = tokyoDayRangeUtc(now).start;
  const payload = { dineIn: 20, takeout: null };
  assert.deepEqual(readWaitTimeSnapshot({ computedAt: new Date(+now - 300_000), payload }, now, start), payload);
  assert.equal(readWaitTimeSnapshot({ computedAt: new Date(+now - 300_001), payload }, now, start), null);
  assert.equal(readWaitTimeSnapshot({ computedAt: new Date(+start - 1), payload }, now, start), null);
  assert.equal(readWaitTimeSnapshot({ computedAt: new Date(+now + 1), payload }, now, start), null);
  assert.equal(readWaitTimeSnapshot({ computedAt: now, payload: { dineIn: 23, takeout: 10 } }, now, start), null);
});

test("40 staff instances share the database lease; staff response does not await aggregation", async () => {
  let leased = false, calculations = 0, writes = 0;
  const callbacks: Array<() => Promise<void>> = [];
  const source = readFileSync(new URL("../lib/server/public-wait-time-refresh.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const load = () => {
    const module = { exports: {} as { schedulePublicWaitTimeRefresh: () => void } };
    vm.runInNewContext(compiled, {
      exports: module.exports, module, console, Date,
      require: (name: string) => {
        if (name === "next/server") return { after: (cb: () => Promise<void>) => callbacks.push(cb) };
        if (name === "node:crypto") return { randomUUID: () => "test-token" };
        if (name === "@/lib/time") return { tokyoDayRangeUtc };
        if (name === "@/lib/domain/wait-time-snapshot") return { WAIT_TIME_REFRESH_MS: 60_000 };
        if (name === "@/lib/server/public-wait-time-calculation") return { calculatePublicWaitTime: async () => {
          calculations++; await new Promise(resolve => setTimeout(resolve, 10));
          return { dineIn: 20, takeout: 15 };
        } };
        if (name === "@/lib/db") return { prisma: {
          $queryRaw: async () => { if (leased) return []; leased = true; return [{ id: 1 }]; },
          $executeRaw: async () => { writes++; return 1; },
        } };
        throw new Error(name);
      },
    });
    return module.exports;
  };
  const instances = Array.from({ length: 40 }, load);
  instances.forEach(instance => { instance.schedulePublicWaitTimeRefresh(); instance.schedulePublicWaitTimeRefresh(); });
  assert.equal(callbacks.length, 40, "At most one scheduled callback per warm process per minute");
  assert.equal(calculations, 0, "Staff response only schedules work");
  await Promise.all(callbacks.map(cb => cb()));
  assert.equal(calculations, 1);
  assert.equal(writes, 1);
});
