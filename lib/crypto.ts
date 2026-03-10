import crypto from "node:crypto";

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createSessionToken(): string {
  return `${crypto.randomUUID()}.${crypto.randomBytes(32).toString("hex")}`;
}

export function hashSecret(secret: string): string {
  return sha256Hex(secret);
}

export function verifySecret(secret: string, hashed: string): boolean {
  return sha256Hex(secret) === hashed;
}

export function chainHash(input: {
  prevHash: string | null;
  timestamp: string;
  actorId: string | null;
  actionType: string;
  entityType: string;
  entityId: string;
  result: string;
}): string {
  const packed = [
    input.prevHash ?? "",
    input.timestamp,
    input.actorId ?? "",
    input.actionType,
    input.entityType,
    input.entityId,
    input.result
  ].join("|");

  return sha256Hex(packed);
}


