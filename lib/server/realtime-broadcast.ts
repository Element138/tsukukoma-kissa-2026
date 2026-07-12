import { Prisma, PrismaClient } from "@prisma/client";
import { publishBulkInvalidation } from "@/lib/server/realtime";

type DbClient = PrismaClient | Prisma.TransactionClient;

export const CHANNEL_GROUPS = {
  ORDER_FLOW: ["orders", "counter", "menus", "audit"] as const,
  ACTORS: ["actors", "orders", "menus", "audit"] as const,
  MENUS: ["menus", "orders", "audit"] as const,
  CATEGORIES: ["categories", "menus", "audit"] as const,
  ASSIGNMENTS: ["assignments", "menus", "orders", "audit"] as const,
  AUDIT: ["audit"] as const
};

export function kitchenChannel(kitchenId: string) {
  return `kitchen:${kitchenId}`;
}

export async function broadcastInvalidation(
  db: DbClient,
  channels: Iterable<string>,
  resource: string,
  reason: string
) {
  await publishBulkInvalidation(db, [...new Set(channels)], resource, reason);
}
