import { ActorType, Prisma, PrismaClient } from "@prisma/client";
import type { RealtimeEnvelope, RealtimeEventType, StaticRealtimeChannel } from "@/lib/realtime";
import { STATIC_REALTIME_CHANNELS } from "@/lib/realtime";
import type { AuthenticatedActor } from "@/lib/server/auth";
import { AppError } from "@/lib/errors";

export const REALTIME_RETENTION_HOURS = 24;
const MAX_CHANNEL_LENGTH = 80;
const MAX_EVENT_TYPE_LENGTH = 32;

type DbClient = PrismaClient | Prisma.TransactionClient;

type RealtimeEventInput = {
  channel: string;
  eventType: RealtimeEventType;
  payload: Record<string, unknown>;
};

const DEFAULT_ALLOWED_STATIC_CHANNELS: Record<ActorType, Set<StaticRealtimeChannel>> = {
  POS: new Set(["orders", "menus", "categories", "actors", "assignments"]),
  KITCHEN: new Set(["orders", "menus", "assignments", "actors"]),
  WAITER: new Set(["orders", "counter", "actors"]),
  MENU_DISPLAY: new Set(["menus", "categories", "orders"]),
  ADMIN: new Set(STATIC_REALTIME_CHANNELS)
};

function asRealtimePayload(payload: Record<string, unknown>): Prisma.InputJsonValue {
  return payload as unknown as Prisma.InputJsonValue;
}

function assertRealtimeInput(input: RealtimeEventInput) {
  if (!input.channel || input.channel.length > MAX_CHANNEL_LENGTH) {
    throw new AppError(400, "INVALID_CHANNEL", "Invalid realtime channel");
  }

  if (!input.eventType || input.eventType.length > MAX_EVENT_TYPE_LENGTH) {
    throw new AppError(400, "INVALID_EVENT_TYPE", "Invalid realtime event type");
  }
}

export function normalizeRequestedChannels(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  return [...new Set(raw.split(",").map((x) => x.trim()).filter(Boolean))];
}

export function isKitchenChannel(channel: string): channel is `kitchen:${string}` {
  return channel.startsWith("kitchen:");
}

export function authorizeRealtimeChannels(actor: AuthenticatedActor, channels: string[]): string[] {
  if (channels.length === 0) {
    throw new AppError(400, "CHANNELS_REQUIRED", "At least one realtime channel is required");
  }

  const allowedStatic = DEFAULT_ALLOWED_STATIC_CHANNELS[actor.actorType];

  const forbidden = channels.filter((channel) => {
    if (isKitchenChannel(channel)) {
      if (actor.actorType === "ADMIN") {
        return false;
      }
      if (actor.actorType !== "KITCHEN") {
        return true;
      }
      return channel !== `kitchen:${actor.actorId}`;
    }

    return !allowedStatic.has(channel as StaticRealtimeChannel);
  });

  if (forbidden.length > 0) {
    throw new AppError(403, "FORBIDDEN", `Not allowed realtime channel(s): ${forbidden.join(", ")}`);
  }

  return channels;
}

export async function publishRealtimeEvent(db: DbClient, input: RealtimeEventInput) {
  assertRealtimeInput(input);

  await db.realtimeEvent.create({
    data: {
      channel: input.channel,
      eventType: input.eventType,
      payload: asRealtimePayload(input.payload)
    }
  });
}

export async function publishRealtimeEvents(db: DbClient, inputs: RealtimeEventInput[]) {
  if (inputs.length === 0) {
    return;
  }

  for (const input of inputs) {
    assertRealtimeInput(input);
  }

  await db.realtimeEvent.createMany({
    data: inputs.map((input) => ({
      channel: input.channel,
      eventType: input.eventType,
      payload: asRealtimePayload(input.payload)
    }))
  });
}

export async function publishBulkInvalidation(
  db: DbClient,
  channels: string[],
  resource: string,
  reason: string
) {
  const uniqueChannels = [...new Set(channels)].filter(Boolean);
  if (uniqueChannels.length === 0) {
    return;
  }

  await publishRealtimeEvents(
    db,
    uniqueChannels.map((channel) => ({
      channel,
      eventType: "BULK_INVALIDATE",
      payload: {
        resource,
        reason
      }
    }))
  );
}

export async function listRealtimeEventsSince(
  db: DbClient,
  channels: string[],
  afterId: number,
  take = 250
): Promise<RealtimeEnvelope[]> {
  if (channels.length === 0) {
    return [];
  }

  const rows = await db.realtimeEvent.findMany({
    where: {
      channel: { in: channels },
      id: { gt: afterId }
    },
    orderBy: { id: "asc" },
    take,
    select: {
      id: true,
      channel: true,
      eventType: true,
      payload: true,
      createdAt: true
    }
  });

  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    eventType: row.eventType as RealtimeEventType,
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString()
  }));
}

export async function getRealtimeBounds(db: DbClient, channels: string[]) {
  if (channels.length === 0) {
    return { oldestId: null as number | null, latestId: null as number | null };
  }

  const where = {
    channel: { in: channels }
  } as const;

  const [oldest, latest] = await Promise.all([
    db.realtimeEvent.findFirst({
      where,
      orderBy: { id: "asc" },
      select: { id: true }
    }),
    db.realtimeEvent.findFirst({
      where,
      orderBy: { id: "desc" },
      select: { id: true }
    })
  ]);

  return {
    oldestId: oldest?.id ?? null,
    latestId: latest?.id ?? null
  };
}

export function retentionCutoff(hours = REALTIME_RETENTION_HOURS) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

export async function pruneRealtimeEvents(db: DbClient, olderThan = retentionCutoff()) {
  const result = await db.realtimeEvent.deleteMany({
    where: {
      createdAt: {
        lt: olderThan
      }
    }
  });

  return result.count;
}
