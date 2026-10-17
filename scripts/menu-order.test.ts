import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { planMenuMove, reorderMenu } from "../lib/domain/menu-order";

const menu = (id: string, displayOrder: number | null) => ({ id, name: id, displayOrder });

test("equal order numbers are moved and normalized instead of swapped to the same number", () => {
  assert.deepEqual(planMenuMove([menu("a", 5), menu("b", 5)], "b", -1), [menu("b", 1), menu("a", 2)].map(({ id, displayOrder }) => ({ id, displayOrder })));
});
test("null and gapped order numbers become consecutive after moving", () => {
  assert.deepEqual(planMenuMove([menu("a", null), menu("b", 20), menu("c", 4)], "a", -1)?.map(m => m.id), ["c", "a", "b"]);
  assert.deepEqual(planMenuMove([menu("a", null), menu("b", 20), menu("c", 4)], "a", -1)?.map(m => m.displayOrder), [1, 2, 3]);
});
test("boundary moves do nothing and stale or deleted menu IDs are rejected", () => {
  assert.equal(planMenuMove([menu("a", 1), menu("b", 2)], "a", -1), null);
  assert.equal(planMenuMove([menu("a", 1), menu("b", 2)], "b", 1), null);
  assert.throws(() => planMenuMove([menu("a", 1)], "deleted", 1), { code: "MENU_CHANGED" });
});
test("moving down then up preserves the order", () => {
  const original = [menu("a", 1), menu("b", 2), menu("c", 3)];
  const down = planMenuMove(original, "a", 1)!;
  const back = planMenuMove(down.map(m => ({ ...m, name: m.id })), "a", -1)!;
  assert.deepEqual(back, original.map(({ id, displayOrder }) => ({ id, displayOrder })));
});
test("reordering locks the category, changes only order fields, and records both sides in one audit", async () => {
  const events: string[] = [], updates: unknown[] = [], audits: any[] = [];
  const tx = {
    $queryRaw: async () => { events.push("lock"); },
    menu: {
      findUnique: async () => ({ id: "b", categoryId: "cat", isActive: true, availability: "AVAILABLE" }),
      findMany: async ({ where }: any) => { assert.deepEqual(where, { categoryId: "cat", isActive: true }); events.push("read"); return [menu("a", 5), menu("b", 5)]; },
      update: async (input: unknown) => { events.push("update"); updates.push(input); },
    },
    auditLog: { findFirst: async () => null, create: async ({ data }: any) => { audits.push(data); } },
  } as unknown as Prisma.TransactionClient;
  assert.deepEqual(await reorderMenu(tx, { menuId: "b", direction: -1, actorId: "admin" }), { changed: true });
  assert.deepEqual(events, ["lock", "read", "update", "update"]);
  assert.deepEqual(updates, [{ where: { id: "b" }, data: { displayOrder: 1 } }, { where: { id: "a" }, data: { displayOrder: 2 } }]);
  assert.equal(audits.length, 1); assert.equal(audits[0].beforeJson.length, 2); assert.equal(audits[0].afterJson.length, 2);
});
