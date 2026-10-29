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
  // Respect the administrator's display order; names have no layout meaning.
  const count = portrait ? 2 : 3;
  return Array.from({ length: Math.ceil(categories.length / count) }, (_, index) => categories.slice(index * count, (index + 1) * count));
}
