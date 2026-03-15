import { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { tokyoDateKey } from "@/lib/time";

type DbClient = PrismaClient | Prisma.TransactionClient;

type MenuCapInput = {
  menuId: string;
  dailyOrderCap: number | null;
};

export type MenuCapState = {
  menuId: string;
  dailyOrderCap: number | null;
  todayCount: number;
  remainingUntilCap: number | null;
  isCapReached: boolean;
};

function buildCapState(menu: MenuCapInput, todayCount: number): MenuCapState {
  const cap = menu.dailyOrderCap;
  const remaining = cap == null ? null : Math.max(0, cap - todayCount);
  return {
    menuId: menu.menuId,
    dailyOrderCap: cap,
    todayCount,
    remainingUntilCap: remaining,
    isCapReached: cap != null && remaining != null && remaining <= 0,
  };
}

export async function getTodayMenuCountMap(
  db: DbClient,
  menuIds: string[],
  jstDate = tokyoDateKey(),
) {
  const uniqueMenuIds = [...new Set(menuIds)];
  if (uniqueMenuIds.length === 0) {
    return new Map<string, number>();
  }

  const rows = await db.menuDailyCount.findMany({
    where: {
      menuId: { in: uniqueMenuIds },
      jstDate,
    },
    select: {
      menuId: true,
      count: true,
    },
  });

  return new Map(rows.map((row) => [row.menuId, row.count]));
}

export async function getMenuCapStates(
  db: DbClient,
  menus: MenuCapInput[],
  jstDate = tokyoDateKey(),
) {
  const countMap = await getTodayMenuCountMap(
    db,
    menus.map((menu) => menu.menuId),
    jstDate,
  );
  return new Map(
    menus.map((menu) => [
      menu.menuId,
      buildCapState(menu, countMap.get(menu.menuId) ?? 0),
    ]),
  );
}

export async function reserveMenuDailyCountsForOrder(
  db: DbClient,
  params: {
    menuNameById: Map<string, string>;
    dailyOrderCapById: Map<string, number | null>;
    quantitiesByMenuId: Map<string, number>;
  },
) {
  const jstDate = tokyoDateKey();

  for (const [menuId, quantity] of params.quantitiesByMenuId) {
    if (quantity <= 0) {
      continue;
    }
    const cap = params.dailyOrderCapById.get(menuId) ?? null;
    if (cap == null) {
      continue;
    }

    await db.menuDailyCount.upsert({
      where: {
        menuId_jstDate: {
          menuId,
          jstDate,
        },
      },
      create: {
        menuId,
        jstDate,
        count: 0,
      },
      update: {},
    });

    const updated = await db.$queryRaw<Array<{ count: number }>>`
      UPDATE "MenuDailyCount"
      SET "count" = "count" + ${quantity}
      WHERE "menuId" = ${menuId}
        AND "jstDate" = ${jstDate}
        AND "count" + ${quantity} <= ${cap}
      RETURNING "count"
    `;

    if (updated.length === 0) {
      const menuName = params.menuNameById.get(menuId) ?? "メニュー";
      throw new AppError(
        409,
        "MENU_CAP_REACHED",
        `${menuName} は本日の上限に達したため注文できません`,
      );
    }
  }
}

export async function resetTodayMenuCount(
  db: DbClient,
  menuId: string,
  jstDate = tokyoDateKey(),
) {
  const count = await db.menuDailyCount.upsert({
    where: {
      menuId_jstDate: {
        menuId,
        jstDate,
      },
    },
    create: {
      menuId,
      jstDate,
      count: 0,
    },
    update: {
      count: 0,
    },
    select: {
      count: true,
    },
  });

  return count.count;
}
