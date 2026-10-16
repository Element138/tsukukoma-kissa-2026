import { NextResponse } from "next/server";
// Production payments must never be confirmed through a simulator.
export async function POST() {
  return NextResponse.json({ ok: false, error: { code: "DEBUG_REMOVED", message: "決済シミュレーターは廃止されました" } }, { status: 410 });
}
