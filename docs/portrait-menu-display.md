# Portrait menu display

Large portrait viewports (at least 900 CSS pixels wide and an aspect ratio of 3:4 or narrower) use a full-height menu board in normal browser mode and fullscreen. The former 1,400px width and 690px category-height caps apply only to the existing landscape layout.

The portrait board has two equally sized sections: food/sweets above and drinks below. Drink categories are identified by `ドリンク`, `飲み物`, `飲料`, `drink`, or `beverage` in their names. Multiple categories in a section are combined while preserving item order, source category labels, category badges, allergens, stock badges, and availability. A single section fills the board. Each section uses two item columns; an odd final item spans both columns. Larger menus continue to scroll within their own section, keeping both headings visible.

Names and prices scale with viewport width (about 76px and 81px respectively at 2160×3840). Portrait styling is isolated from the existing landscape columns and category pagination. Media-query changes and ResizeObserver measurements update the layout and scroll distances on rotation, resizing, fullscreen changes, and font loading.

Validation: `npx tsx scripts/menu-display-layout.test.ts` and `npx tsx scripts/portrait-menu-browser-check.ts` (local app on port 3120). The browser check covers 2160×3840 and 1080×1920, normal/fullscreen, landscape rotation, separate food/sweets categories, images, labels, unclipped content, and large-menu scrolling. Set `MENU_DISPLAY_FIXTURE` to a JSON fixture file to inspect a specific public menu without modifying database records.
