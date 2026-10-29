import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getMenuDisplayData } from "@/lib/server/menu-display-data";

const getSnapshot = unstable_cache(getMenuDisplayData, ["public-menu-display-v1"], { revalidate: 15 });

// Public menu information only. No sessions, orders, actors or administrative data.
export async function GET(req: NextRequest) {
  try {
    const { categories, settings } = await getSnapshot();
    const etag = `"${createHash("sha256").update(JSON.stringify({ categories, settings })).digest("hex")}"`;
    const headers = { "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=15", ETag: etag, "X-Content-Type-Options": "nosniff" };
    if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
    return NextResponse.json({ ok: true, data: { categories, settings, serverNow: new Date().toISOString() } }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: { code: "MENU_UNAVAILABLE", message: "メニューを取得できません" } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
