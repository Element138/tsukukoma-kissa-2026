type Item = { id: string; menuId: string; itemNameSnapshot: string; status: string };
type Group = { name: string; count: number };

// Demand includes every unserved item, even when its menu has no ready stock.
export function projectCounterStock(
  menus: Array<{ id: string; name: string; shortName: string | null; isActive: boolean }>,
  stocks: Array<{ menuId: string; readyCount: number }>,
  orders: Array<{ items: Array<{ menuId: string; status: string }> }>,
) {
  const waiting = new Map<string, number>();
  for (const order of orders) {
    for (const item of order.items) {
      if (item.status === "QUEUED") waiting.set(item.menuId, (waiting.get(item.menuId) ?? 0) + 1);
    }
  }
  const ready = new Map(stocks.map(stock => [stock.menuId, stock.readyCount]));
  return menus.filter(menu => (ready.get(menu.id) ?? 0) > 0)
    .map(menu => ({ menuId: menu.id, name: menu.shortName?.trim() || menu.name, waitingCount: waiting.get(menu.id) ?? 0, count: ready.get(menu.id) ?? 0 }));
}

// Evaluate every order against the same pool, without reserving it for any order.
export function projectCounterItems(items: Item[], stock: ReadonlyMap<string, number>) {
  const remaining = new Map(stock);
  const readyItems: Array<{ id: string; name: string }> = [];
  const unreadyItemGroups: Group[] = [];
  const servedItemGroups: Group[] = [];
  for (const item of items) {
    const count = remaining.get(item.menuId) ?? 0;
    if (item.status === "QUEUED" && count > 0) {
      readyItems.push({ id: item.id, name: item.itemNameSnapshot });
      remaining.set(item.menuId, count - 1);
    } else if (item.status === "QUEUED" || item.status === "SERVED") {
      const groups = item.status === "SERVED" ? servedItemGroups : unreadyItemGroups;
      const group = groups.find(g => g.name === item.itemNameSnapshot);
      if (group) group.count++;
      else groups.push({ name: item.itemNameSnapshot, count: 1 });
    }
  }
  return { readyItems, servedItemGroups, unreadyItemGroups };
}
