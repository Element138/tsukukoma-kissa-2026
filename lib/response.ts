import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

function isEnvMissingDbUrl(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /Environment variable not found: DATABASE_URL/i.test(error.message);
}

export function fail(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      { status: error.status }
    );
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "DB_UNAVAILABLE",
          message: "Database is not reachable"
        }
      },
      { status: 503 }
    );
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2021") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "DB_NOT_MIGRATED",
            message: "Database schema is not ready. Run migrations."
          }
        },
        { status: 503 }
      );
    }

    if (error.code === "P1001") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "DB_UNREACHABLE",
            message: "Cannot reach database server"
          }
        },
        { status: 503 }
      );
    }

    if (error.code === "P1000") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "DB_AUTH_FAILED",
            message: "Database authentication failed"
          }
        },
        { status: 503 }
      );
    }
  }

  if (isEnvMissingDbUrl(error)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "SERVER_MISCONFIG",
          message: "DATABASE_URL is missing in environment variables"
        }
      },
      { status: 500 }
    );
  }

  console.error(error);
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error"
      }
    },
    { status: 500 }
  );
}
