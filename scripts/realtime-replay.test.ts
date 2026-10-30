import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { coalesceRefresh } from "../lib/client/coalesce-refresh";

async function streamFixture(cursor: number) {
  const polls: number[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const source = readFileSync(new URL("../app/api/realtime/events/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const modules: Record<string, unknown> = {
    "@/lib/db": { prisma: {} },
    "@/lib/errors": { AppError: Error },
    "@/lib/response": { fail: () => new Response(null, { status: 500 }) },
    "@/lib/server/auth": { requireSession: async () => ({ actorId: "pos-test", actorType: "POS" }) },
    "@/lib/server/realtime": {
      normalizeRequestedChannels: () => ["orders"],
      authorizeRealtimeChannels: (_actor: unknown, channels: string[]) => channels,
      getRealtimeBounds: async () => ({ oldestId: 10, latestId: 300 }),
      listRealtimeEventsSince: async (_db: unknown, _channels: string[], afterId: number) => { polls.push(afterId); return []; },
    },
  };
  const addTimer = (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; };
  const clearTimer = (id: number) => timers.delete(id);
  vm.runInNewContext(compiled, {
    exports, require: (id: string) => { if (!(id in modules)) throw new Error(`Unexpected import ${id}`); return modules[id]; },
    TextEncoder, ReadableStream, Response, console,
    setInterval: addTimer, clearInterval: clearTimer, setTimeout: addTimer, clearTimeout: clearTimer,
  });
  const response = await exports.GET({
    headers: new Headers(), nextUrl: new URL(`https://example.test/api/realtime/events?channels=orders&cursor=${cursor}`),
    signal: new AbortController().signal,
  });
  assert.equal(response.status, 200);
  return { response: response as Response, polls, timers };
}

test("fresh SSE subscriptions start at the latest event, with one snapshot invalidation", async () => {
  const f = await streamFixture(0);
  const reader = f.response.body!.getReader();
  const decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /retry:/);
  const snapshot = decoder.decode((await reader.read()).value);
  assert.match(snapshot, /stream_started/);
  assert.match(snapshot, /BULK_INVALIDATE/);
  assert.deepEqual(f.polls, [300], "must not replay 250 historical events from cursor zero");
  const callbacks = [...f.timers.values()];
  await reader.cancel();
  assert.equal(f.timers.size, 0, "disconnected streams must stop database polling");
  for (const callback of callbacks.slice(0, 2)) callback();
  assert.deepEqual(f.polls, [300]);
});

test("valid reconnect cursors replay missed events; expired cursors use a snapshot", async () => {
  for (const [cursor, expected] of [[40, 40], [5, 300]]) {
    const f = await streamFixture(cursor);
    assert.deepEqual(f.polls, [expected]);
    await f.response.body!.cancel();
    assert.equal(f.timers.size, 0);
  }
});

test("250 invalidations during a request produce only one trailing request", async () => {
  let calls = 0;
  let resolveFirst!: () => void;
  let started!: () => void;
  const first = new Promise<void>(resolve => { resolveFirst = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const refresh = coalesceRefresh(async () => {
    calls++;
    if (calls === 1) { started(); await first; }
  });
  const initial = refresh();
  await ready;
  const replay = Array.from({ length: 250 }, () => refresh());
  assert.equal(calls, 1);
  resolveFirst();
  await Promise.all([initial, ...replay]);
  assert.equal(calls, 2);
});

test("a failed refresh releases the single-flight lock", async () => {
  let fail = true;
  const refresh = coalesceRefresh(async () => { if (fail) throw new Error("offline"); });
  await assert.rejects(refresh(), /offline/);
  fail = false;
  await refresh();
});
