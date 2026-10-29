import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { assert } from "@/lib/errors";
import { fail, ok } from "@/lib/response";
import { tokyoDateKey } from "@/lib/time";
import { menuLastOrderTime, parseMenuLastOrder } from "@/lib/menu-last-order";
import { writeAuditLog } from "@/lib/domain/audit";
import { broadcastInvalidation } from "@/lib/server/realtime-broadcast";

const dateSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const saveSchema = dateSchema.extend({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) });

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ADMIN"] });
    const today = tokyoDateKey();
    const entries = await prisma.menuDisplayLastOrder.findMany({ where: { jstDate: { gte: today } }, orderBy: { jstDate: "asc" } });
    return ok({ today, entries: entries.map(entry => ({ date: entry.jstDate, time: menuLastOrderTime(entry.closesAt), closesAt: entry.closesAt })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}

async function mutate(req: NextRequest, remove: boolean) {
  try {
    const admin = await requireSession(req, { actorTypes: ["ADMIN"] });
    assert(req.headers.get("origin") === req.nextUrl.origin, 403, "FORBIDDEN", "同一サイトから操作してください");
    const body = await parseJson(req, remove ? dateSchema : saveSchema);
    const closesAt = parseMenuLastOrder(body.date, "time" in body ? String(body.time) : "00:00");
    assert(closesAt, 400, "INVALID_LAST_ORDER_DATE", "有効な日付と時刻を入力してください");
    assert(body.date >= tokyoDateKey(), 400, "LAST_ORDER_PAST_DATE", "本日以降の日付を選択してください");
    await prisma.$transaction(async tx => {
      // Serialize per date so audit before/after values match concurrent edits.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'menu-last-order:' + body.date}, 0))::text`;
      const before = await tx.menuDisplayLastOrder.findUnique({ where: { jstDate: body.date } });
      if (remove) await tx.menuDisplayLastOrder.deleteMany({ where: { jstDate: body.date } });
      else await tx.menuDisplayLastOrder.upsert({ where: { jstDate: body.date }, create: { jstDate: body.date, closesAt }, update: { closesAt } });
      await writeAuditLog(tx, {
        actorId: admin.actorId, actorType: "ADMIN", actionType: remove ? "MENU_LAST_ORDER_REMOVED" : "MENU_LAST_ORDER_SET",
        entityType: "menu_last_order", entityId: body.date, result: "SUCCESS",
        beforeJson: { closesAt: before?.closesAt.toISOString() ?? null },
        afterJson: { date: body.date, closesAt: remove ? null : closesAt.toISOString() },
      });
      await broadcastInvalidation(tx, ["settings", "menus", "audit"], "settings", "menu_last_order_changed");
    });
    return ok({ saved: true });
  } catch (error) { return fail(error); }
}
export async function PUT(req: NextRequest) { return mutate(req, false); }
export async function DELETE(req: NextRequest) { return mutate(req, true); }
