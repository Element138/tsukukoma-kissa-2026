import { NextRequest } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
import { getMenuDisplayData } from "@/lib/server/menu-display-data";

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["MENU_DISPLAY", "POS", "ADMIN"] });
    return ok(await getMenuDisplayData());
  } catch (error) { return fail(error); }
}
