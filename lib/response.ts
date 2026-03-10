import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
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


