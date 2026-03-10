import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { runPaymentWatchdog } from "@/lib/domain/payment-watchdog";

export async function GET(req: NextRequest) {
  try {
    const configuredSecret = process.env.CRON_SECRET;
    if (configuredSecret) {
      const sent = req.headers.get("x-cron-secret");
      if (sent !== configuredSecret) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    const result = await prisma.$transaction((tx) => runPaymentWatchdog(tx));
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}


