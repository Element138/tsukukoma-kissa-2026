import { BlobNotFoundError, head, put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { fail } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { synthesizeJapaneseSpeechMp3 } from "@/lib/server/google-tts";

export const runtime = "nodejs";

type AudioPart = "number" | "customer";

function parsePart(raw: string): AudioPart {
  if (raw === "number" || raw === "customer") {
    return raw;
  }
  throw new AppError(400, "VALIDATION_ERROR", "Invalid audio part");
}

function parseOrderNo(raw: string) {
  const orderNo = Number(raw);
  if (!Number.isInteger(orderNo) || orderNo < 1 || orderNo > 999999) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid order number");
  }
  return orderNo;
}

function textForPart(part: AudioPart, orderNo: number) {
  return part === "number" ? `${orderNo}番。` : `${orderNo}番のお客様。`;
}

async function findCachedAudio(pathname: string, token: string) {
  try {
    return await head(pathname, { token });
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return null;
    }
    console.error("order number audio cache lookup failed", error);
    return null;
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ part: string; orderNo: string }> },
) {
  try {
    await requireSession(req, { actorTypes: ["ORDER_DISPLAY", "ADMIN"] });
    const { part: rawPart, orderNo: rawOrderNo } = await context.params;
    const part = parsePart(rawPart);
    const orderNo = parseOrderNo(rawOrderNo);
    const pathname = `order-call/numbers/${part}-${orderNo}.mp3`;
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

    if (blobToken) {
      const cached = await findCachedAudio(pathname, blobToken);
      if (cached) {
        return NextResponse.redirect(cached.url, 307);
      }
    }

    const audio = await synthesizeJapaneseSpeechMp3(textForPart(part, orderNo));

    if (blobToken) {
      try {
        const uploaded = await put(pathname, audio, {
          token: blobToken,
          access: "public",
          contentType: "audio/mpeg",
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 31536000,
        });
        return NextResponse.redirect(uploaded.url, 307);
      } catch (error) {
        console.error("order number audio cache upload failed", error);
      }
    }

    return new NextResponse(audio, {
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
