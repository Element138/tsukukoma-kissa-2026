import { createHmac } from "crypto";
import type { AuthenticatedActor } from "@/lib/server/auth";
import { AppError } from "@/lib/errors";

const SUPABASE_REALTIME_TOKEN_TTL_SECONDS = 5 * 60;

type RealtimeTokenClaims = {
  aud: "authenticated";
  role: "authenticated";
  sub: string;
  actor_id: string;
  actor_type: string;
  channels: string[];
  iat: number;
  exp: number;
};

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function encodeHmacSha256(data: string, secret: string) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function signHs256Jwt(payload: RealtimeTokenClaims, secret: string) {
  const header = {
    alg: "HS256",
    typ: "JWT"
  };

  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = encodeHmacSha256(signingInput, secret);
  return `${signingInput}.${signature}`;
}

function resolveSupabaseJwtSecret() {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new AppError(
      500,
      "SERVER_MISCONFIG",
      "SUPABASE_JWT_SECRET is missing in environment variables"
    );
  }
  return secret;
}

export function issueSupabaseRealtimeToken(params: {
  actor: AuthenticatedActor;
  channels: string[];
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const exp = nowSec + SUPABASE_REALTIME_TOKEN_TTL_SECONDS;

  const claims: RealtimeTokenClaims = {
    aud: "authenticated",
    role: "authenticated",
    sub: params.actor.actorId,
    actor_id: params.actor.actorId,
    actor_type: params.actor.actorType,
    channels: params.channels,
    iat: nowSec,
    exp
  };

  const token = signHs256Jwt(claims, resolveSupabaseJwtSecret());
  return {
    token,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}
