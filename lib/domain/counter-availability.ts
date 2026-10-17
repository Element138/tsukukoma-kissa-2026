type Item = { id: string; menuId: string; itemNameSnapshot: string; status: string };
type Group = { name: string; count: number };

export type CounterServingPlan = { menuId: string; name: string; waitingCount: number; servableCount: number };
export function counterServingPlan(items: Item[], stock: ReadonlyMap<string, number>): CounterServingPlan[] {
  const groups = new Map<string, CounterServingPlan>();
  for (const item of items) if (item.status === "QUEUED") {
    const group = groups.get(item.menuId) ?? { menuId: item.menuId, name: item.itemNameSnapshot, waitingCount: 0, servableCount: 0 };
    group.waitingCount++; groups.set(item.menuId, group);
  }
  return [...groups.values()].sort((a,b)=>a.menuId.localeCompare(b.menuId)).map(group=>({ ...group, servableCount: Math.min(group.waitingCount, stock.get(group.menuId) ?? 0) }));
}

export function partialServingMessage(plan: CounterServingPlan[]) {
  return plan.filter(group=>group.servableCount < group.waitingCount).map(group=>`${group.name}は調理済の数が足りないため、${group.waitingCount}個のうち${group.servableCount}個のみ提供済にします。`).join("\n");
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
