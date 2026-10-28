import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { assert } from "@/lib/errors";
import { ok, fail } from "@/lib/response";
import { signCashierPhoto } from "@/lib/server/cashier-photo-storage";

export async function GET(req: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  try {
    await requireSession(req, { actorTypes: ["POS", "KITCHEN", "WAITER", "ADMIN"] });
    const { orderId } = await context.params;
    const photo = await prisma.cashierPhoto.findUnique({ where: { orderId } });
    assert(photo, 404, "PHOTO_NOT_FOUND", "会計者画像はありません");
    const url = photo.storedAt && photo.objectPath ? await signCashierPhoto(photo.objectPath) : null;
    return ok({ url, capturedAt: photo.capturedAt, waived: Boolean(photo.waivedAt) }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return fail(error); }
}
