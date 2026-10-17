import type { Prisma } from "@prisma/client";
import { assert } from "@/lib/errors";
import { writeAuditLog } from "@/lib/domain/audit";

type OrderedMenu = { id: string; name: string; displayOrder: number | null };

export function planMenuMove(menus: OrderedMenu[], menuId: string, direction: -1 | 1) {
  const ordered = [...menus].sort((a, b) =>
    (a.displayOrder ?? 9999) - (b.displayOrder ?? 9999) || a.name.localeCompare(b.name, "ja") || a.id.localeCompare(b.id));
  const index = ordered.findIndex(menu => menu.id === menuId);
  assert(index >= 0, 409, "MENU_CHANGED", "メニューが変更されました。更新して再度お試しください");
  const target = index + direction;
  if (target < 0 || target >= ordered.length) return null;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return ordered.map((menu, index) => ({ id: menu.id, displayOrder: index + 1 }));
}

// The caller wraps this in one transaction; serialize moves within a category.
export async function reorderMenu(tx: Prisma.TransactionClient, params: { menuId: string; direction: -1 | 1; actorId: string }) {
  const menu = await tx.menu.findUnique({ where: { id: params.menuId } });
  assert(menu, 404, "MENU_NOT_FOUND", "メニューが見つかりません");
  assert(menu.isActive, 409, "MENU_DELETED", "削除済みのメニューは並び替えできません");
  await tx.$queryRaw`SELECT id FROM "MenuCategory" WHERE id = ${menu.categoryId} FOR UPDATE`;
  const before = await tx.menu.findMany({
    where: { categoryId: menu.categoryId, isActive: true },
    select: { id: true, name: true, displayOrder: true },
  });
  const after = planMenuMove(before, params.menuId, params.direction);
  if (!after) return { changed: false };
  const previousOrders = new Map(before.map(menu => [menu.id, menu.displayOrder]));
  for (const menu of after) {
    if (previousOrders.get(menu.id) !== menu.displayOrder) {
      await tx.menu.update({ where: { id: menu.id }, data: { displayOrder: menu.displayOrder } });
    }
  }
  await writeAuditLog(tx, {
    actorId: params.actorId, actorType: "ADMIN", actionType: "MENU_ORDER_UPDATED",
    entityType: "menu_category", entityId: menu.categoryId,
    beforeJson: before.map(menu => ({ id: menu.id, displayOrder: menu.displayOrder })),
    afterJson: after, result: "SUCCESS",
  });
  return { changed: true };
}
