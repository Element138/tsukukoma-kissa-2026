import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, service: "kissa", now: new Date().toISOString() });
}


