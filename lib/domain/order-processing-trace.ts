import { Prisma } from "@prisma/client";
import { formatTokyo } from "@/lib/time";

type ParsedOrderEvent = {
  type: string;
  at: Date;
  detail: Record<string, unknown> | null;
};

export type OrderProcessingTrace = {
  createdAt: Date;
  failedAt: Date | null;
  failureReasonType: string | null;
  failureReasonText: string | null;
  successCallbackAt: Date | null;
};

function parseDateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseOrderEvents(raw: Prisma.JsonValue | null): ParsedOrderEvent[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const events: ParsedOrderEvent[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }

    const record = row as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";
    const at = parseDateOrNull(record.at);
    const detail =
      record.detail && typeof record.detail === "object" && !Array.isArray(record.detail)
        ? (record.detail as Record<string, unknown>)
        : null;

    if (!type || !at) {
      continue;
    }
    events.push({ type, at, detail });
  }

  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function latestEventOfType(events: ParsedOrderEvent[], types: ReadonlySet<string>): ParsedOrderEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (types.has(event.type)) {
      return event;
    }
  }
  return null;
}

function normalizeReasonType(event: ParsedOrderEvent | null): string | null {
  if (!event) {
    return null;
  }
  const explicitReasonType = event.detail?.reasonType;
  if (typeof explicitReasonType === "string" && explicitReasonType.trim().length > 0) {
    return explicitReasonType.trim().toUpperCase();
  }
  if (event.type === "ORDER_FAILED") {
    return "MANUAL_CANCEL";
  }
  return null;
}

function normalizeReasonText(event: ParsedOrderEvent | null): string | null {
  if (!event) {
    return null;
  }
  const reasonText = event.detail?.reasonText;
  if (typeof reasonText !== "string") {
    return null;
  }
  const normalized = reasonText.trim();
  return normalized.length > 0 ? normalized : null;
}

export function deriveOrderProcessingTrace(params: {
  createdAt: Date;
  events: Prisma.JsonValue | null;
}): OrderProcessingTrace {
  const events = parseOrderEvents(params.events);
  const failure = latestEventOfType(events, new Set(["PAYMENT_FAILED", "ORDER_FAILED"]));
  const successCallback = latestEventOfType(
    events,
    new Set(["PAYMENT_SUCCESS_CALLBACK_AFTER_FAILED", "PAYMENT_SUCCESS"]),
  );

  return {
    createdAt: params.createdAt,
    failedAt: failure?.at ?? null,
    failureReasonType: normalizeReasonType(failure),
    failureReasonText: normalizeReasonText(failure),
    successCallbackAt: successCallback?.at ?? null,
  };
}

export function failureReasonLabel(reasonType: string | null): string {
  switch ((reasonType ?? "").toUpperCase()) {
    case "TIMEOUT":
      return "タイムアウト";
    case "FAILURE_CALLBACK":
      return "失敗コールバック";
    case "MANUAL_CANCEL":
      return "手動キャンセル";
    case "MANUAL_FAILURE":
      return "手動失敗処理";
    default:
      return "不明";
  }
}

export function formatTraceAt(date: Date | null): string {
  if (!date) {
    return "不明";
  }
  return `${formatTokyo(date)} JST`;
}

export function buildLateSuccessIncidentMessage(params: {
  orderNo: number;
  createdAt: Date;
  failedAt: Date | null;
  failureReasonType: string | null;
  failureReasonText: string | null;
  successCallbackAt: Date;
}): string {
  const reasonLabel = failureReasonLabel(params.failureReasonType);
  const reasonDetail = params.failureReasonText ? ` / ${params.failureReasonText}` : "";
  return (
    `注文 #${params.orderNo} の処理トレース: 作成=${formatTraceAt(params.createdAt)}, ` +
    `失敗=${formatTraceAt(params.failedAt)}（${reasonLabel}${reasonDetail}）, ` +
    `SUCCESSコールバック受信=${formatTraceAt(params.successCallbackAt)}。` +
    "入金有無を確認してください。"
  );
}
