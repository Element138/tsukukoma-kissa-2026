import { NextRequest } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { fail } from "@/lib/response";
import { AppError } from "@/lib/errors";
export async function POST(req: NextRequest) {
 try { await requireSession(req, { actorTypes: ["WAITER"] }); throw new AppError(410, "BULK_SERVE_REMOVED", "アイテム単位で提供してください"); } catch (e) { return fail(e); }
}
