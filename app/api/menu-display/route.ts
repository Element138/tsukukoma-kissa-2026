import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { normalizeSpecifiedAllergens } from "@/lib/allergens";

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
        create: { id: 1, menuDisplayPageSeconds: 18 },
        update: {},
      }),
    ]);

    const result = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      displayOrder: cat.displayOrder,
      menus: menus
        .filter((menu) => menu.categoryId === cat.id)
        .map((menu) => ({
          id: menu.id,
          name: menu.name,
          priceJpy: menu.priceJpy,
          availability: menu.availability,
          coverImageDataUrl: menu.coverImageDataUrl,
          allergens: normalizeSpecifiedAllergens(menu.allergensJson),
          customBadgeText: menu.customBadgeText,
          customBadgeColor: menu.customBadgeColor,
        })),
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
