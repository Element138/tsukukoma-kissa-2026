import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/domain/audit";
import { resetTodayMenuCount } from "@/lib/domain/menu-cap";
import { AppError } from "@/lib/errors";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";
import { adminMenuCountResetSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
    const body = await parseJson(req, adminMenuCountResetSchema);

    const result = await prisma.$transaction(async (tx) => {
      const menu = await tx.menu.findUnique({
        where: { id: body.menuId },
        select: {
          id: true,
          name: true,
          isActive: true,
        },
      });
      if (!menu || !menu.isActive) {
        throw new AppError(404, "MENU_NOT_FOUND", "menu not found");
      }

      const count = await resetTodayMenuCount(tx, menu.id);

      await writeAuditLog(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        actionType: "MENU_DAILY_COUNT_RESET",
        entityType: "menu",
        entityId: menu.id,
        afterJson: {
          count,
        },
        result: "SUCCESS",
      });

      await broadcastInvalidation(
        tx,
        [...CHANNEL_GROUPS.MENUS, ...CHANNEL_GROUPS.ORDER_FLOW],
        "menus",
        "menu_daily_count_reset",
      );

      return {
        menuId: menu.id,
        menuName: menu.name,
        todayOrderCount: count,
      };
    });

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
