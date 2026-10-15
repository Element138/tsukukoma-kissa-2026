type Item = { id: string; menuId: string; itemNameSnapshot: string; status: string };
type Group = { name: string; count: number };

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
