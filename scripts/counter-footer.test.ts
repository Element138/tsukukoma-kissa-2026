import test from "node:test";
import assert from "node:assert/strict";
import { projectCounterStock } from "../lib/domain/counter-availability";
import { menuUpdateSchema } from "../lib/validation";

const menu = { id: "coffee", name: "アイスコーヒー", shortName: null, isActive: true };
const items = (count: number, menuId = "coffee", status = "QUEUED") => Array.from({ length: count }, () => ({ menuId, status }));

for (const [waitingCount, count] of [[3, 5], [0, 5], [7, 5], [2, 0], [0, 0]]) {
  test(`footer shows all demand and stock independently: ${waitingCount}/${count}`, () => {
    const result = projectCounterStock([menu], count ? [{ menuId: "coffee", readyCount: count }] : [], [
      { items: items(Math.min(1, waitingCount)) },
      { items: [...items(Math.max(0, waitingCount - 1)), ...items(2, "coffee", "SERVED")] },
    ]);
    assert.deepEqual(result, [{ menuId: "coffee", name: "アイスコーヒー", waitingCount, count }]);
  });
}

test("footer uses optional short names with the main name as fallback", () => {
  for (const shortName of [null, "", "  ", " コーヒー "]) {
    assert.equal(projectCounterStock([{ ...menu, shortName }], [], [])[0].name, shortName?.trim() || menu.name);
  }
});

test("inactive menus stay visible while demand or ready stock remains", () => {
  const inactive = { ...menu, isActive: false };
  assert.equal(projectCounterStock([inactive], [], []).length, 0);
  assert.equal(projectCounterStock([inactive], [], [{ items: items(2) }])[0].waitingCount, 2);
  assert.equal(projectCounterStock([inactive], [{ menuId: "coffee", readyCount: 5 }], [])[0].count, 5);
});

test("menu short name can be set, cleared, or left unchanged", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.equal(menuUpdateSchema.parse({ id, shortName: " コーヒー " }).shortName, "コーヒー");
  assert.equal(menuUpdateSchema.parse({ id, shortName: " " }).shortName, null);
  assert.equal(menuUpdateSchema.parse({ id, shortName: null }).shortName, null);
  assert.equal(menuUpdateSchema.parse({ id }).shortName, undefined);
  assert.equal(menuUpdateSchema.safeParse({ id, shortName: "あ".repeat(121) }).success, false);
});
