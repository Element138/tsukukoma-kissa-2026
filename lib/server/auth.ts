import { ActorType, Prisma, Session } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AppError, assert } from "@/lib/errors";
import { createSessionToken, sha256Hex } from "@/lib/crypto";
import { minutesFromNow, now } from "@/lib/time";

export const SESSION_COOKIE = "kissa_session";
const SESSION_TTL_MINUTES = 10;

export type AuthenticatedActor = {
  actorId: string;
  actorType: ActorType;
  label: string;
  sessionId: string;
};

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: minutesFromNow(SESSION_TTL_MINUTES)
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

async function loadSession(req: NextRequest): Promise<(Session & { actor: { id: string; actorType: ActorType; label: string; isActive: boolean } }) | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
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
          isActive: true
        }
      }
    }
  });

  if (!session || session.revokedAt || session.expiresAt <= now() || !session.actor.isActive) {
    return null;
  }

  return session;
}

async function touchSession(sessionId: string) {
  await prisma.session.update({
    where: { sessionId },
    data: {
      lastActivityAt: now(),
      expiresAt: minutesFromNow(SESSION_TTL_MINUTES)
    }
  });
}

async function touchActorOnline(actorId: string) {
  await prisma.actor.update({
    where: { id: actorId },
    data: {
      online: true,
      lastSeenAt: now()
    }
  });
}

export async function requireSession(
  req: NextRequest,
  options?: {
    actorTypes?: ActorType[];
  }
): Promise<AuthenticatedActor> {
  const session = await loadSession(req);
  assert(session, 401, "UNAUTHORIZED", "Session required");

  if (options?.actorTypes && !options.actorTypes.includes(session.actor.actorType)) {
    throw new AppError(403, "FORBIDDEN", "Actor type is not allowed");
  }

  await Promise.all([touchSession(session.sessionId), touchActorOnline(session.actor.id)]);

  return {
    actorId: session.actor.id,
    actorType: session.actor.actorType,
    label: session.actor.label,
    sessionId: session.sessionId
  };
}

export async function createSession(actor: { id: string; actorType: ActorType }, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;

  if (actor.actorType !== "MENU_DISPLAY") {
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
      expiresAt: minutesFromNow(SESSION_TTL_MINUTES)
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
