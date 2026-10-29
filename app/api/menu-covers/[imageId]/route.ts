import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Food images are public; cashier photos and menu metadata remain authenticated.
export async function GET(req: NextRequest, context: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await context.params;
  if (!/^[a-f0-9]{64}$/.test(imageId)) return new NextResponse(null, { status: 404 });
  try {
    const image = await prisma.menuCoverImage.findUnique({ where: { id: imageId } });
    if (!image) return new NextResponse(null, { status: 404 });
    const headers = {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ETag: `"${imageId}"`,
    };
    if (req.headers.get("if-none-match") === headers.ETag) return new NextResponse(null, { status: 304, headers });
    return new NextResponse(new Uint8Array(image.bytes), { headers });
  } catch {
    return new NextResponse(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
