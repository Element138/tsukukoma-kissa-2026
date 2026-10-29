import { prisma } from "@/lib/db";
import { getMenuCapStates } from "@/lib/domain/menu-cap";
import { normalizeSpecifiedAllergens } from "@/lib/allergens";
import { normalizeMenuCoverUrl } from "@/lib/menu-cover";
import { tokyoDateKey } from "@/lib/time";
import type { Prisma, PrismaClient } from "@prisma/client";

const LOW_STOCK_BADGE_THRESHOLD_UNLIMITED = 100000;

// Explicit projection shared by authenticated displays and the public read-only feed.
export async function getMenuDisplayData(db: PrismaClient | Prisma.TransactionClient = prisma, includeLastOrders = true, includeVisibility = true) {
    const [categories, menus, setting, lastOrders] = await Promise.all([
      db.menuCategory.findMany({
        where: { isActive: true },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, displayOrder: true, customBadgeText: true, customBadgeColor: true },
      }),
      db.menu.findMany({
        where: { isActive: true, ...(includeVisibility ? { showOnMenuDisplay: true } : {}) },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, categoryId: true, priceJpy: true, availability: true, coverImageDataUrl: true, allergensJson: true, allergenDisplayEnabled: true, customBadgeText: true, customBadgeColor: true, dailyOrderCap: true, lowStockBadgeThreshold: true },
      }),
      db.appSetting.findUnique({ where: { id: 1 }, select: { menuDisplayPageSeconds: true } }),
      includeLastOrders ? db.menuDisplayLastOrder.findMany({
        where: { jstDate: { gte: tokyoDateKey() } },
        select: { jstDate: true, closesAt: true },
        orderBy: { jstDate: "asc" },
      }) : Promise.resolve([]),
    ]);
    const capStateMap = await getMenuCapStates(
      db,
      menus.map((menu) => ({
        menuId: menu.id,
        dailyOrderCap: menu.dailyOrderCap ?? null,
      })),
    );

    const result = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      displayOrder: cat.displayOrder,
      customBadgeText: cat.customBadgeText,
      customBadgeColor: cat.customBadgeColor,
      menus: menus
        .filter((menu) => menu.categoryId === cat.id)
        .map((menu) => {
          const capState = capStateMap.get(menu.id);
          const isCapReached = capState?.isCapReached ?? false;
          const remainingUntilCap = capState?.remainingUntilCap ?? null;
          const hasThresholdInput =
            menu.lowStockBadgeThreshold < LOW_STOCK_BADGE_THRESHOLD_UNLIMITED;
          const showLowStockBadge =
            hasThresholdInput &&
            menu.dailyOrderCap != null &&
            remainingUntilCap != null &&
            remainingUntilCap <= menu.lowStockBadgeThreshold;

          return {
            id: menu.id,
            name: menu.name,
            priceJpy: menu.priceJpy,
            availability: isCapReached ? "SOLD_OUT" : menu.availability,
            coverImageDataUrl: normalizeMenuCoverUrl(menu.coverImageDataUrl),
            allergens: normalizeSpecifiedAllergens(menu.allergensJson),
            allergenDisplayEnabled: menu.allergenDisplayEnabled,
            customBadgeText: menu.customBadgeText,
            customBadgeColor: menu.customBadgeColor,
            showLowStockBadge,
            remainingUntilCap,
          };
        }),
    }));

    return {
      categories: result,
      serverNow: new Date().toISOString(),
      settings: {
        pageDisplaySeconds: setting?.menuDisplayPageSeconds ?? 18,
        lastOrders: lastOrders.map(entry => ({ date: entry.jstDate, closesAt: entry.closesAt })),
      },
    };
}
