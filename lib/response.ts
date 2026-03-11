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

function failPrismaKnown(error: Prisma.PrismaClientKnownRequestError) {
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

  if (error.code === "P2022") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "DB_SCHEMA_MISMATCH",
          message: "Database columns are out of sync with the app schema."
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

  if (error.code === "P2002") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UNIQUE_CONSTRAINT",
          message: "A record with the same unique key already exists."
        }
      },
      { status: 409 }
    );
  }

  if (error.code === "P2003") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "FK_CONSTRAINT",
          message: "The requested relation is invalid (foreign key constraint)."
        }
      },
      { status: 409 }
    );
  }

  if (error.code === "P2025") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Target record was not found."
        }
      },
      { status: 404 }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: error.code,
        message: "Database request failed"
      }
    },
    { status: 500 }
  );
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
    return failPrismaKnown(error);
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