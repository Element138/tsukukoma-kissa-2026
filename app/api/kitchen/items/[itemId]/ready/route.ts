import { NextRequest } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { fail } from "@/lib/response";
import { AppError } from "@/lib/errors";
export async function POST(req: NextRequest) {
  try { await requireSession(req, { actorTypes: ["KITCHEN"] }); throw new AppError(410, "ITEM_READY_REMOVED", "メニューごとの個数で調理完了にしてください"); } catch (e) { return fail(e); }
}
