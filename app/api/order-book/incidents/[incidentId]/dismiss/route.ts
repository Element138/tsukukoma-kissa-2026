import { NextResponse } from "next/server";

// Stale browser tabs must not hide an incident without payment reconciliation.
export async function POST() {
  return NextResponse.json({
    ok: false,
    error: { code: "PAYMENT_INCIDENT_DISMISSAL_REMOVED", message: "異常通知の確認済み操作は廃止されました。管理者が決済を照合してください。" },
  }, { status: 410 });
}
