import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getMenuCapStates } from "@/lib/domain/menu-cap";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { normalizeSpecifiedAllergens } from "@/lib/allergens";

const LOW_STOCK_BADGE_THRESHOLD_UNLIMITED = 100000;

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["MENU_DISPLAY", "POS", "ADMIN"] });

    const [categories, menus, setting] = await Promise.all([
      prisma.menuCategory.findMany({
        where: { isActive: true },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      }),
      prisma.menu.findMany({
        where: { isActive: true },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      }),
      prisma.appSetting.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          menuDisplayPageSeconds: 18,
          orderDisplayMarqueeText: "",
          orderDisplayMarqueeSpeedSeconds: 24,
        },
        update: {},
      }),
    ]);
    const capStateMap = await getMenuCapStates(
      prisma,
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
            coverImageDataUrl: menu.coverImageDataUrl,
            allergens: normalizeSpecifiedAllergens(menu.allergensJson),
            allergenDisplayEnabled: menu.allergenDisplayEnabled,
            customBadgeText: menu.customBadgeText,
            customBadgeColor: menu.customBadgeColor,
            showLowStockBadge,
            remainingUntilCap,
          };
        }),
    }));

    return ok({
      categories: result,
      settings: {
        pageDisplaySeconds: setting.menuDisplayPageSeconds,
      },
    });
  } catch (error) {
    return fail(error);
  }
}
