import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";

function percentile75(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rawIndex = Math.ceil(sorted.length * 0.75) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rawIndex));
  return sorted[index] ?? null;
}

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["MENU_DISPLAY", "POS", "ADMIN"] });

    const [categories, menus, setting] = await Promise.all([
      prisma.menuCategory.findMany({
        where: { isActive: true },
        orderBy: [
          { displayOrder: "asc" },
          { name: "asc" },
        ],
      }),
      prisma.menu.findMany({
        where: { isActive: true },
        orderBy: [
          { displayOrder: "asc" },
          { name: "asc" },
        ],
      }),
      prisma.appSetting.upsert({
        where: { id: 1 },
        create: { id: 1, menuDisplayPageSeconds: 18 },
        update: {},
      }),
    ]);

    const since = new Date(Date.now() - 30 * 60_000);
    const recentServed = await prisma.orderItem.findMany({
      where: {
        servedAt: { gte: since },
        status: "SERVED"
      },
      select: {
        menuId: true,
        servedAt: true,
        order: {
          select: {
            confirmedAt: true
          }
        }
      }
    });

    const leadMap = new Map<string, number[]>();
    for (const row of recentServed) {
      if (!row.servedAt || !row.order.confirmedAt) {
        continue;
      }

      const leadSec = Math.max(0, Math.floor((row.servedAt.getTime() - row.order.confirmedAt.getTime()) / 1000));
      const arr = leadMap.get(row.menuId) ?? [];
      arr.push(leadSec);
      leadMap.set(row.menuId, arr);
    }

    const result = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      displayOrder: cat.displayOrder,
      menus: menus
        .filter((m) => m.categoryId === cat.id)
        .map((menu) => ({
          id: menu.id,
          name: menu.name,
          priceJpy: menu.priceJpy,
          availability: menu.availability,
          leadTimeSecondsP75_30m: menu.showLeadTime ? percentile75(leadMap.get(menu.id) ?? []) : null,
          coverImageDataUrl: menu.coverImageDataUrl,
        }))
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
