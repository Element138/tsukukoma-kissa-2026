import test from "node:test";
import assert from "node:assert/strict";
import type { BrowserContext } from "playwright-core";
import { createReceiptPageRunner } from "../lib/receipt/receipt-browser";
import { RECEIPT_PAPER } from "../lib/receipt/paper";

function fixture() {
  let launches = 0;
  let closes = 0;
  const closeEvents: Array<() => void> = [];
  const runner = createReceiptPageRunner(async () => {
    launches++;
    return {
      pages: () => [{ isClosed: () => false }],
      on: (_event: string, callback: () => void) => { closeEvents.push(callback); },
      close: async () => { closes++; },
    } as unknown as BrowserContext;
  });
  return { runner, closeEvents, counts: () => ({ launches, closes }) };
}

test("repeated and concurrent receipts reuse one default context without closing each other", async () => {
  const { runner, counts } = fixture();
  let active = 0;
  let maxActive = 0;
  const outputs = await Promise.all([1, 2, 3].map(id => runner.run(async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--; return id;
  })));
  assert.deepEqual(outputs, [1, 2, 3]);
  assert.equal(maxActive, 1);
  assert.deepEqual(counts(), { launches: 1, closes: 0 });
  await runner.close();
  assert.deepEqual(counts(), { launches: 1, closes: 1 });
});

test("a failed render releases the queue and recreates the browser for the next receipt", async () => {
  const { runner, counts } = fixture();
  await assert.rejects(runner.run(async () => { throw new Error("Browser crashed"); }));
  assert.equal(await runner.run(async () => "recovered"), "recovered");
  assert.deepEqual(counts(), { launches: 2, closes: 1 });
  await runner.close();
});

test("a browser closed by the server is not reused", async () => {
  const { runner, closeEvents, counts } = fixture();
  await runner.run(async () => "first"); closeEvents[0]();
  await runner.run(async () => "second");
  assert.equal(counts().launches, 2);
  await runner.close();
});

test("printable width stays inside both increased horizontal margins", () => {
  for (const paper of Object.values(RECEIPT_PAPER)) {
    assert.equal(paper.printableWidthMm + paper.horizontalMarginMm * 2, paper.paperWidthMm);
  }
});
