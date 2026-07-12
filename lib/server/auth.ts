import { ActorType, Prisma, Session } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AppError, assert } from "@/lib/errors";
import { createSessionToken, sha256Hex } from "@/lib/crypto";
import { minutesFromNow, now } from "@/lib/time";

export const SESSION_COOKIE = "kissa_session";
const SESSION_TTL_MINUTES = 10;
const DISPLAY_TTL_MINUTES = 60 * 12;
const HEARTBEAT_TOUCH_MS = 10_000;

type SessionActor = {
  id: string;
  actorType: ActorType;
  label: string;
  isActive: boolean;
  lastSeenAt: Date | null;
};

export type AuthenticatedActor = {
  actorId: string;
  actorType: ActorType;
  label: string;
  sessionId: string;
};

type SessionFailureCode =
  | "SESSION_MISSING"
  | "SESSION_INVALID"
  | "SESSION_REVOKED"
  | "SESSION_EXPIRED"
  | "ACTOR_INACTIVE";

type SessionLoadResult = {
  session: (Session & { actor: SessionActor }) | null;
  failureCode: SessionFailureCode | null;
};

const SESSION_FAILURE_MESSAGE: Record<SessionFailureCode, string> = {
  SESSION_MISSING: "ログインが必要です",
  SESSION_INVALID: "セッションが無効です",
  SESSION_REVOKED: "セッションが無効化されています",
  SESSION_EXPIRED: "セッションの有効期限が切れました",
  ACTOR_INACTIVE: "アカウントが無効化されています"
};

function sessionTtlMinutes(actorType: ActorType) {
  return actorType === "MENU_DISPLAY" || actorType === "ORDER_DISPLAY" ? DISPLAY_TTL_MINUTES : SESSION_TTL_MINUTES;
}

function isStale(ts: Date | null | undefined) {
  if (!ts) {
    return true;
  }
  return Date.now() - ts.getTime() >= HEARTBEAT_TOUCH_MS;
}

export function setSessionCookie(response: NextResponse, token: string, actorType: ActorType) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(actorType === "MENU_DISPLAY" || actorType === "ORDER_DISPLAY"
      ? {
          expires: minutesFromNow(sessionTtlMinutes(actorType))
        }
      : {
          // Keep the browser cookie stable and let server-side session TTL drive actual auth expiry.
          maxAge: 60 * 60 * 24 * 30
        })
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    path: "/",
    maxAge: 0
  });
}

async function loadSession(req: NextRequest): Promise<SessionLoadResult> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return { session: null, failureCode: "SESSION_MISSING" };
  }

  const tokenHash = sha256Hex(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      actor: {
        select: {
          id: true,
          actorType: true,
          label: true,
          isActive: true,
          lastSeenAt: true
        }
      }
    }
  });

  if (!session) {
    return { session: null, failureCode: "SESSION_INVALID" };
  }
  if (session.revokedAt) {
    return { session: null, failureCode: "SESSION_REVOKED" };
  }
  if (!session.actor.isActive) {
    return { session: null, failureCode: "ACTOR_INACTIVE" };
  }
  if (session.expiresAt <= now()) {
    return { session: null, failureCode: "SESSION_EXPIRED" };
  }

  return { session, failureCode: null };
}

async function touchSession(session: Session & { actor: SessionActor }) {
  await prisma.session.updateMany({
    where: { sessionId: session.sessionId },
    data: {
      lastActivityAt: now(),
      ...(session.actor.actorType === "MENU_DISPLAY" || session.actor.actorType === "ORDER_DISPLAY"
        ? {}
        : {
            expiresAt: minutesFromNow(SESSION_TTL_MINUTES)
          })
    }
  });
}

async function touchActorOnline(actorId: string) {
  await prisma.actor.updateMany({
    where: { id: actorId },
    data: {
      online: true,
      lastSeenAt: now()
    }
  });
}

async function touchHeartbeatBestEffort(session: Session & { actor: SessionActor }) {
  const tasks: Promise<unknown>[] = [];

  if (isStale(session.lastActivityAt)) {
    tasks.push(touchSession(session));
  }
  if (isStale(session.actor.lastSeenAt)) {
    tasks.push(touchActorOnline(session.actor.id));
  }

  if (tasks.length === 0) {
    return;
  }

  try {
    await Promise.all(tasks);
  } catch (error) {
    console.warn("heartbeat touch failed", error);
  }
}

export async function requireSession(
  req: NextRequest,
  options?: {
    actorTypes?: ActorType[];
  }
): Promise<AuthenticatedActor> {
  const loaded = await loadSession(req);
  assert(loaded.session, 401, loaded.failureCode ?? "UNAUTHORIZED", SESSION_FAILURE_MESSAGE[loaded.failureCode ?? "SESSION_INVALID"]);

  if (options?.actorTypes && !options.actorTypes.includes(loaded.session.actor.actorType)) {
    throw new AppError(403, "FORBIDDEN", "この操作を実行する権限がありません");
  }

  await touchHeartbeatBestEffort(loaded.session);

  return {
    actorId: loaded.session.actor.id,
    actorType: loaded.session.actor.actorType,
    label: loaded.session.actor.label,
    sessionId: loaded.session.sessionId
  };
}

export async function createSession(actor: { id: string; actorType: ActorType }, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;

  if (actor.actorType !== "MENU_DISPLAY" && actor.actorType !== "ORDER_DISPLAY") {
    await db.session.updateMany({
      where: {
        actorId: actor.id,
        revokedAt: null
      },
      data: {
        revokedAt: now()
      }
    });
  }

  const token = createSessionToken();
  const tokenHash = sha256Hex(token);

  const session = await db.session.create({
    data: {
      actorId: actor.id,
      tokenHash,
      expiresAt: minutesFromNow(sessionTtlMinutes(actor.actorType))
    }
  });

  return {
    token,
    sessionId: session.sessionId
  };
}

export async function revokeCurrentSession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return;
  }

  const tokenHash = sha256Hex(token);
  await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: now() }
  });
}
