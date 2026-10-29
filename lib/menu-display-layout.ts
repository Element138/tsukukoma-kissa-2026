export const PORTRAIT_MENU_QUERY = "(min-width: 900px) and (max-aspect-ratio: 3/4)";

type Category<T> = {
  id: string;
  name: string;
  customBadgeText: string | null;
  customBadgeColor: string | null;
  menus: T[];
};

export type MenuCategoryContext = {
  sourceCategoryName?: string;
  sourceCategoryBadgeText?: string | null;
  sourceCategoryBadgeColor?: string | null;
};

export function menuDisplayPages<T extends MenuCategoryContext>(categories: Category<T>[], portrait: boolean): Category<T>[][] {
  if (!categories.length) return [];
  if (!portrait) {
    const count = Math.min(3, categories.length);
    return Array.from({ length: Math.ceil(categories.length / count) }, (_, index) => categories.slice(index * count, (index + 1) * count));
  }
  const drinks = categories.filter(category => /ドリンク|飲み物|飲料|drink|beverage/i.test(category.name));
  const food = categories.filter(category => !drinks.includes(category));
  const section = (items: Category<T>[], id: string, name: string): Category<T> => ({
    id, name: items.length === 1 ? items[0].name : name,
    customBadgeText: items.length === 1 ? items[0].customBadgeText : null,
    customBadgeColor: items.length === 1 ? items[0].customBadgeColor : null,
    menus: items.flatMap(category => category.menus.map(menu => items.length === 1 ? menu : ({
      ...menu, sourceCategoryName: category.name,
      sourceCategoryBadgeText: category.customBadgeText,
      sourceCategoryBadgeColor: category.customBadgeColor,
    }))),
  });
  return [[
    ...(food.length ? [section(food, "portrait-food", "フード・スイーツ")] : []),
    ...(drinks.length ? [section(drinks, "portrait-drinks", "ドリンク")] : []),
  ]];
}
