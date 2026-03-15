import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/response";
import { partitionRealtimeChannels } from "@/lib/realtime";
import { requireSession } from "@/lib/server/auth";
import { authorizeRealtimeChannels, normalizeRequestedChannels } from "@/lib/server/realtime";
import { issueSupabaseRealtimeToken } from "@/lib/server/supabase-realtime-token";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireSession(req);
    const requested = normalizeRequestedChannels(req.nextUrl.searchParams.get("channels"));
    const allowed = authorizeRealtimeChannels(actor, requested);
    const { ops } = partitionRealtimeChannels(allowed);

    if (ops.length === 0) {
      return ok({
        token: null,
        channels: [] as string[],
        expiresAt: null as string | null
      });
    }

    const issued = issueSupabaseRealtimeToken({
      actor,
      channels: ops
    });

    return ok({
      token: issued.token,
      channels: ops,
      expiresAt: issued.expiresAt
    });
  } catch (error) {
    return fail(error);
  }
}
