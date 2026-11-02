import { getPublicWaitTime } from "@/lib/server/public-wait-time";
import { renderPublicWaitTime } from "@/lib/server/public-wait-time-html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const html = renderPublicWaitTime(await getPublicWaitTime());
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=30",
      "CDN-Cache-Control": "public, s-maxage=60",
      "Vercel-CDN-Cache-Control": "public, s-maxage=60",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
