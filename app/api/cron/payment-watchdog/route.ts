import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { runPaymentWatchdog } from "@/lib/domain/payment-watchdog";
import { pruneRealtimeEvents } from "@/lib/server/realtime";

export async function GET(req: NextRequest) {
  try {
    const configuredSecret = process.env.CRON_SECRET;
    if (configuredSecret) {
      const sent = req.headers.get("x-cron-secret");
      if (sent !== configuredSecret) {
        return new Response("認証に失敗しました", { status: 401 });
      }
    }

    const result = await prisma.$transaction((tx) => runPaymentWatchdog(tx));
    const prunedRealtimeEvents = await pruneRealtimeEvents(prisma);

    return ok({
      ...result,
      prunedRealtimeEvents
    });
  } catch (error) {
    return fail(error);
  }
}
