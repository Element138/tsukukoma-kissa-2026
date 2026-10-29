import assert from "node:assert/strict";
import { menuDisplayPages, type MenuCategoryContext } from "../lib/menu-display-layout";

type Item = MenuCategoryContext & { id: string; name: string };
const category = (id: string, name: string, badge: string | null = null) => ({ id, name, customBadgeText: badge, customBadgeColor: "#0f766e", menus: [{ id: `${id}-item`, name: `${id} item` } as Item] });
const first = category("drinks", "ドリンク", "おすすめ");
const second = category("food", "フード・スイーツ");
for (const portrait of [true, false]) {
  const pages = menuDisplayPages([first, second], portrait);
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0], [first, second]);
  assert.equal(pages[0][0], first);
}
const categories = [first, second, category("third", "Anything"), category("fourth", "More drinks")];
assert.deepEqual(menuDisplayPages(categories, true).map(page => page.map(group => group.id)), [["drinks", "food"], ["third", "fourth"]]);
assert.deepEqual(menuDisplayPages(categories, false).map(page => page.map(group => group.id)), [["drinks", "food", "third"], ["fourth"]]);
assert.deepEqual(menuDisplayPages([], true), []);
assert.deepEqual(menuDisplayPages([first], true), [[first]]);
console.log("Menu layout checks passed: category order and identities preserved regardless of names, two categories stay on one page, ordered pagination for larger menus.");
