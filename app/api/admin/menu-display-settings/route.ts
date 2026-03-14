import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { parseJson } from "@/lib/server/http";
import { writeAuditLog } from "@/lib/domain/audit";
import { broadcastInvalidation, CHANNEL_GROUPS } from "@/lib/server/realtime-broadcast";

const updateSchema = z.object({
  pageDisplaySeconds: z.number().int().min(6).max(120),
});

async function ensureSetting() {
  return prisma.appSetting.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      menuDisplayPageSeconds: 18,
    },
    update: {},
  });
}

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ADMIN", "MENU_DISPLAY"] });

    const setting = await ensureSetting();
    return ok({
      settings: {
        pageDisplaySeconds: setting.menuDisplayPageSeconds,
      },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireSession(req, { actorTypes: ["ADMIN"] });
    const body = await parseJson(req, updateSchema);
    const before = await ensureSetting();

    const setting = await prisma.$transaction(async (tx) => {
      const updated = await tx.appSetting.update({
        where: { id: 1 },
        data: {
          menuDisplayPageSeconds: body.pageDisplaySeconds,
        },
      });

      await writeAuditLog(tx, {
        actorId: actor.actorId,
        actorType: actor.actorType,
        actionType: "MENU_DISPLAY_SETTINGS_UPDATED",
        entityType: "app_setting",
        entityId: "1",
        beforeJson: {
          menuDisplayPageSeconds: before.menuDisplayPageSeconds,
        },
        afterJson: {
          menuDisplayPageSeconds: updated.menuDisplayPageSeconds,
        },
        result: "SUCCESS",
      });

      await broadcastInvalidation(
        tx,
        CHANNEL_GROUPS.MENUS,
        "settings",
        "menu_display_page_seconds_updated",
      );

      return updated;
    });

    return ok({
      settings: {
        pageDisplaySeconds: setting.menuDisplayPageSeconds,
      },
    });
  } catch (error) {
    return fail(error);
  }
}
