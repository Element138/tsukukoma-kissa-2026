import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid] ?? null;
}

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["MENU_DISPLAY", "POS", "ADMIN"] });

    const categories = await prisma.menuCategory.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" }
    });

    const menus = await prisma.menu.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }]
    });

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
        .map((menu) => {
          const med = menu.showLeadTime ? median(leadMap.get(menu.id) ?? []) : null;
          return {
            id: menu.id,
            name: menu.name,
            priceJpy: menu.priceJpy,
            availability: menu.availability,
            leadTimeSecondsMedian30m: med
          };
        })
    }));

    return ok({ categories: result });
  } catch (error) {
    return fail(error);
  }
}


