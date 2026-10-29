const text = (value, max = 500) => {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid menu text");
  return value;
};
const optionalText = value => value == null ? null : text(value);
const number = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid menu number");
  return value;
};

// Project onto the display contract. Nothing else from a feed is persisted or served.
export function validateMenu(data) {
  if (!data || !Array.isArray(data.categories) || data.categories.length > 100) throw new Error("Invalid categories");
  let count = 0;
  const categories = data.categories.map(category => {
    if (!Array.isArray(category.menus) || (count += category.menus.length) > 1000) throw new Error("Invalid menu items");
    return {
      id: text(category.id), name: text(category.name),
      customBadgeText: optionalText(category.customBadgeText), customBadgeColor: optionalText(category.customBadgeColor),
      menus: category.menus.map(menu => {
        if (!["AVAILABLE", "INCREASED_WAIT", "PAUSED", "SOLD_OUT"].includes(menu.availability)) throw new Error("Invalid availability");
        if (!Array.isArray(menu.allergens) || menu.allergens.some(key => !["EGG", "MILK", "WHEAT", "SHRIMP", "CRAB", "WALNUT", "PEANUT", "BUCKWHEAT"].includes(key))) throw new Error("Invalid allergens");
        if (typeof menu.allergenDisplayEnabled !== "boolean" || typeof menu.showLowStockBadge !== "boolean") throw new Error("Invalid menu flags");
        return { id: text(menu.id), name: text(menu.name), priceJpy: number(menu.priceJpy), availability: menu.availability,
          coverImageDataUrl: menu.coverImageDataUrl == null ? null : text(menu.coverImageDataUrl, 300_000),
          allergens: menu.allergens, allergenDisplayEnabled: menu.allergenDisplayEnabled,
          customBadgeText: optionalText(menu.customBadgeText), customBadgeColor: optionalText(menu.customBadgeColor),
          showLowStockBadge: menu.showLowStockBadge, remainingUntilCap: menu.remainingUntilCap == null ? null : number(menu.remainingUntilCap) };
      }),
    };
  });
  const seconds = number(data.settings?.pageDisplaySeconds);
  if (seconds < 6 || seconds > 120 || !Array.isArray(data.settings.lastOrders) || data.settings.lastOrders.length > 10000) throw new Error("Invalid settings");
  const lastOrders = data.settings.lastOrders.map(entry => {
    const date = text(entry.date, 10), closesAt = text(entry.closesAt, 40);
    const parsed = new Date(closesAt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || new Date(parsed.getTime() + 9 * 3600_000).toISOString().slice(0, 10) !== date) throw new Error("Invalid closing time");
    return { date, closesAt };
  });
  return { categories, settings: { pageDisplaySeconds: seconds, lastOrders } };
}
