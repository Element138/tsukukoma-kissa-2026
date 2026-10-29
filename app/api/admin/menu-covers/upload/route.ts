import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { assert } from "@/lib/errors";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { MENU_COVER_MAX_INPUT_BYTES } from "@/lib/menu-cover";
import { compressMenuCover } from "@/lib/server/menu-cover-image";

export async function POST(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["ADMIN"] });
    assert(req.headers.get("origin") === req.nextUrl.origin, 403, "FORBIDDEN", "同一サイトから操作してください");
    const form = await req.formData();
    const file = form.get("file");
    assert(file instanceof File, 400, "IMAGE_FILE_REQUIRED", "画像を選択してください");
    assert(["image/png", "image/jpeg", "image/webp"].includes(file.type), 415, "UNSUPPORTED_IMAGE_TYPE", "PNG・JPEG・WebPの画像を選択してください");
    assert(file.size > 0 && file.size <= MENU_COVER_MAX_INPUT_BYTES, 413, "IMAGE_TOO_LARGE", "画像は1 MB以下にしてください");
    const bytes = await compressMenuCover(new Uint8Array(await file.arrayBuffer()));
    const id = createHash("sha256").update(bytes).digest("hex");
    // Identical content reuses an immutable image row.
    await prisma.menuCoverImage.upsert({ where: { id }, create: { id, bytes: new Uint8Array(bytes) }, update: {} });
    const url = `/api/menu-covers/${id}`;
    return ok({ url, pathname: url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
