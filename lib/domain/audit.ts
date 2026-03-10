import { ActorType, AuditResult, Prisma, PrismaClient } from "@prisma/client";
import { chainHash } from "@/lib/crypto";

type DbClient = PrismaClient | Prisma.TransactionClient;

type AuditInput = {
  actorId?: string | null;
  actorType?: ActorType | null;
  actionType: string;
  entityType: string;
  entityId: string;
  orderId?: string | null;
  beforeJson?: Prisma.InputJsonValue | null;
  afterJson?: Prisma.InputJsonValue | null;
  reasonType?: string | null;
  reasonText?: string | null;
  result: AuditResult;
  correlationId?: string | null;
};

export async function writeAuditLog(db: DbClient, input: AuditInput) {
  const prev = await db.auditLog.findFirst({
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    select: { hash: true }
  });

  const timestamp = new Date();
  const prevHash = prev?.hash ?? null;

  const hash = chainHash({
    prevHash,
    timestamp: timestamp.toISOString(),
    actorId: input.actorId ?? null,
    actionType: input.actionType,
    entityType: input.entityType,
    entityId: input.entityId,
    result: input.result
  });

  await db.auditLog.create({
    data: {
      timestamp,
      actorId: input.actorId ?? null,
      actorType: input.actorType ?? null,
      actionType: input.actionType,
      entityType: input.entityType,
      entityId: input.entityId,
      orderId: input.orderId ?? null,
      beforeJson: input.beforeJson ?? Prisma.JsonNull,
      afterJson: input.afterJson ?? Prisma.JsonNull,
      reasonType: input.reasonType ?? null,
      reasonText: input.reasonText ?? null,
      result: input.result,
      correlationId: input.correlationId ?? null,
      prevHash,
      hash
    }
  });
}


