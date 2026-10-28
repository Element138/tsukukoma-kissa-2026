import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/http";
import { photoStorageState, ignorePhotoStorageToday } from "@/lib/domain/cashier-photos";
import { photoOverrideActive } from "@/lib/cashier-photo-policy";
import { broadcastInvalidation } from "@/lib/server/realtime-broadcast";
import { assert } from "@/lib/errors";
import { ok, fail } from "@/lib/response";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ADMIN", "POS"] });
    const state = await prisma.$transaction(tx => photoStorageState(tx));
    return ok({ failed: Boolean(state.failedAt), ignoreActive: photoOverrideActive(state.ignoreUntil), ignoreUntil: state.ignoreUntil },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireSession(req, { actorTypes: ["ADMIN"] });
    assert(req.headers.get("origin") === req.nextUrl.origin, 403, "FORBIDDEN", "同一サイトから操作してください");
    await parseJson(req, z.object({ confirm: z.literal(true) }));
    const state = await prisma.$transaction(async tx => {
      const updated = await ignorePhotoStorageToday(tx, admin.actorId);
      await broadcastInvalidation(tx, ["orders", "audit"], "photo_storage", "photo_storage_failure_dismissed");
      return updated;
    });
    return ok({ ignoreUntil: state.ignoreUntil });
  } catch (error) { return fail(error); }
}
