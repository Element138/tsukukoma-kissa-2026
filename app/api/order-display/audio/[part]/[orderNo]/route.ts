import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { fail } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { synthesizeJapaneseSpeechMp3 } from "@/lib/server/google-tts";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ part: string; orderNo: string }> },
) {
  try {
    await requireSession(req, { actorTypes: ["ORDER_DISPLAY", "ADMIN"] });
    const { part, orderNo: rawOrderNo } = await context.params;
    if (part === "extreme-long-wait") {
      return NextResponse.redirect(new URL("/audio/order-call/extreme-long-wait-apology.mp3", req.url));
    }
    if (part !== "number" && part !== "customer") {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid audio part");
    }
    const orderNo = Number(rawOrderNo);
    if (!Number.isInteger(orderNo) || orderNo < 1 || orderNo > 999999) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid order number");
    }
    // Keep older clients working without Blob reads or writes.
    if (orderNo <= 2000) {
      return NextResponse.redirect(new URL(`/audio/order-call/numbers/v2/${part}-${orderNo}.mp3`, req.url));
    }
    const audio = await synthesizeJapaneseSpeechMp3(
      part === "number" ? `${orderNo}番。` : `${orderNo}番のお客様。`,
    );
    return new NextResponse(audio, {
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "public, max-age=31536000, immutable",
        "x-order-audio-cache": "synthesized",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
