import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { partitionRealtimeChannels } from "@/lib/realtime";
import { fail } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import {
  authorizeRealtimeChannels,
  getRealtimeBounds,
  listRealtimeEventsSince,
  normalizeRequestedChannels
} from "@/lib/server/realtime";
import type { RealtimeEnvelope } from "@/lib/realtime";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;
const POLL_MS = 1_000;
const ROTATE_MS = 55_000;
const RETRY_MS = 2_000;

function parseCursor(req: NextRequest): number {
  const headerValue = req.headers.get("last-event-id") ?? "";
  const queryValue = req.nextUrl.searchParams.get("cursor") ?? "";
  const headerCursor = Number(headerValue);
  const queryCursor = Number(queryValue);
  const safeHeader = Number.isFinite(headerCursor) && headerCursor > 0 ? headerCursor : 0;
  const safeQuery = Number.isFinite(queryCursor) && queryCursor > 0 ? queryCursor : 0;
  return Math.max(safeHeader, safeQuery);
}

function channelResource(channel: string): string {
  if (channel.startsWith("kitchen:")) {
    return "kitchen";
  }
  return channel;
}

function encodeEnvelope(envelope: RealtimeEnvelope) {
  return `id: ${envelope.id}\nevent: realtime\ndata: ${JSON.stringify(envelope)}\n\n`;
}

function encodeSyntheticEvent(channel: string, reason: string) {
  const payload = {
    id: 0,
    channel,
    eventType: "BULK_INVALIDATE",
    payload: {
      resource: channelResource(channel),
      reason
    },
    createdAt: new Date().toISOString()
  };
  return `event: realtime\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requireSession(req);
    const requested = normalizeRequestedChannels(req.nextUrl.searchParams.get("channels"));
    const allowed = authorizeRealtimeChannels(actor, requested);
    const { sse: channels } = partitionRealtimeChannels(allowed);
    if (channels.length === 0) {
      throw new AppError(
        400,
        "SSE_CHANNEL_NOT_SUPPORTED",
        "Requested channels are handled by Supabase Realtime"
      );
    }

    const initialCursor = parseCursor(req);
    const bounds = await getRealtimeBounds(prisma, channels);

    const cursorTooOld =
      initialCursor > 0 &&
      bounds.oldestId !== null &&
      initialCursor < bounds.oldestId - 1;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        let lastId = cursorTooOld ? bounds.latestId ?? initialCursor : initialCursor;
        let pollBusy = false;

        const write = (chunk: string) => {
          if (!closed) {
            controller.enqueue(encoder.encode(chunk));
          }
        };

        const sendEnvelopes = (envelopes: RealtimeEnvelope[]) => {
          for (const envelope of envelopes) {
            write(encodeEnvelope(envelope));
            lastId = Math.max(lastId, envelope.id);
          }
        };

        const pollOnce = async () => {
          if (closed || pollBusy) {
            return;
          }
          pollBusy = true;
          try {
            const events = await listRealtimeEventsSince(prisma, channels, lastId);
            if (events.length > 0) {
              sendEnvelopes(events);
            }
          } catch (error) {
            console.error("realtime poll failed", error);
          } finally {
            pollBusy = false;
          }
        };

        write(`retry: ${RETRY_MS}\n\n`);

        if (cursorTooOld) {
          for (const channel of channels) {
            write(encodeSyntheticEvent(channel, "cursor_too_old"));
          }
        }

        void pollOnce();

        const heartbeatTimer = setInterval(() => {
          write(`: heartbeat ${Date.now()}\n\n`);
        }, HEARTBEAT_MS);

        const pollTimer = setInterval(() => {
          void pollOnce();
        }, POLL_MS);

        const rotationTimer = setTimeout(() => {
          write(`event: close\ndata: {"reason":"rotation"}\n\n`);
          cleanup();
          controller.close();
        }, ROTATE_MS);

        const onAbort = () => {
          cleanup();
          try {
            controller.close();
          } catch {
            // noop
          }
        };

        const cleanup = () => {
          if (closed) {
            return;
          }
          closed = true;
          clearInterval(heartbeatTimer);
          clearInterval(pollTimer);
          clearTimeout(rotationTimer);
          req.signal.removeEventListener("abort", onAbort);
        };

        req.signal.addEventListener("abort", onAbort);
      },
      cancel() {
        // noop: timers are cleaned in abort/rotation path above
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (error) {
    return fail(error);
  }
}


