import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

const ERROR_MESSAGE_JA: Record<string, string> = {
  UNAUTHORIZED: "認証が必要です",
  FORBIDDEN: "この操作を実行する権限がありません",
  SESSION_MISSING: "ログインが必要です",
  SESSION_INVALID: "セッションが無効です",
  SESSION_REVOKED: "セッションが無効化されています",
  SESSION_EXPIRED: "セッションの有効期限が切れました",
  ACTOR_INACTIVE: "アカウントが無効化されています",

  INVALID_JSON: "リクエスト本文の JSON 形式が不正です",
  VALIDATION_ERROR: "入力内容に誤りがあります",
  INVALID_OPERATION: "無効な操作です",
  INVALID_STATUS: "現在の状態では実行できません",
  INVALID_ACTOR_TYPE: "無効なアクター種別です",
  INVALID_CHANNEL: "無効なリアルタイムチャンネルです",
  INVALID_EVENT_TYPE: "無効なリアルタイムイベント種別です",
  CHANNELS_REQUIRED: "リアルタイムチャンネルを 1 つ以上指定してください",
  CHANNEL_FORBIDDEN: "指定されたチャンネルへのアクセス権限がありません",
  ORDER_ID_REQUIRED: "注文 ID が必要です",
  INVALID_SIGNATURE: "コールバック署名が不正です",
  CONFIRMATION_REQUIRED: "確認文字列が必要です",
  ACTOR_ID_REQUIRED: "アクター ID を指定してください",
  CATEGORY_ID_REQUIRED: "カテゴリ ID を指定してください",
  IMAGE_FILE_REQUIRED: "画像ファイルを指定してください",
  INVALID_KITCHEN_FIELD:
    "kitchenEnabled / kitchenDisplayOrder は KITCHEN でのみ指定できます",
  INVALID_KITCHEN_ACTOR: "指定されたキッチン情報が不正です",
  INVALID_SOURCE_KITCHEN: "移管元キッチンが無効です",
  NOT_KITCHEN_ACTOR: "対象アクターはキッチンではありません",
  MENU_DISPLAY_SINGLETON: "メニュー表示アカウントは 1 つのみ作成できます",

  ACTOR_NOT_FOUND: "アクターが見つかりません",
  CATEGORY_NOT_FOUND: "カテゴリが見つかりません",
  MENU_NOT_FOUND: "メニューが見つかりません",
  ITEM_NOT_FOUND: "対象の注文品目が見つかりません",
  ORDER_NOT_FOUND: "注文が見つかりません",
  KITCHEN_NOT_FOUND: "キッチンが見つかりません",
  UNDO_NOT_FOUND: "取り消し対象が見つかりません",
  UNDO_TARGET_MISSING: "取り消し対象が見つかりません",

  ITEM_NOT_QUEUED: "調理待ちの品目のみ操作できます",
  ITEM_NOT_READY: "提供待ちの品目のみ操作できます",
  ITEM_CONFLICT: "品目の状態が変わったため操作できません",
  KITCHEN_MISMATCH: "このキッチンでは操作できません",
  KITCHEN_INACTIVE: "対象キッチンは稼働していません",
  MENU_UNAVAILABLE: "選択したメニューは現在注文できません",
  MENU_CAP_REACHED: "本日の上限に達しています",
  NO_ACTIVE_KITCHEN: "有効なキッチン割り当てがありません",
  MENU_DELETED: "削除済みメニューは編集できません",
  MENU_DELETE_PERMANENT: "削除済みメニューは復元できません",
  ALREADY_CONFIRMED: "この注文はすでに確定済みです",
  EMPTY_ITEMS: "注文品目がありません",
  ORDER_EMPTY: "注文品目がありません",
  ORDER_LOCKED: "この注文は現在変更できません",
  ORDER_NOT_PENDING: "保留中の注文のみ操作できます",
  ORDER_NOT_READY: "未提供の準備完了品目があるため完了できません",
  ORDER_CANCELED: "取消済み注文は操作できません",
  NOT_DINE_IN: "店内注文のみ操作できます",
  NOT_TAKEOUT: "持ち帰り注文のみ操作できます",

  UNDO_FORBIDDEN: "この操作は取り消しできません",
  UNDO_UNSUPPORTED: "この種類の操作は取り消し未対応です",
  UNDO_TARGET_CHANGED: "対象が変更されたため取り消しできません",
  UNDO_CONFLICT: "取り消し対象の状態が変化したため実行できません",

  DB_NOT_MIGRATED:
    "データベース初期化が未完了です。マイグレーションを実行してください",
  DB_SCHEMA_MISMATCH: "データベース構成がアプリと一致していません",
  DB_POOL_TIMEOUT:
    "データベース接続が混雑しています。時間をおいて再試行してください",
  DB_UNAVAILABLE: "データベースに接続できません",
  DB_UNREACHABLE: "データベースに接続できません",
  DB_TIMEOUT: "データベース処理がタイムアウトしました",
  UNIQUE_CONSTRAINT: "同じ値のデータがすでに存在します",
  FK_CONSTRAINT: "関連データの整合性エラーが発生しました",
  TX_CONFLICT: "データ競合が発生しました。再試行してください",
  SERVER_MISCONFIG: "サーバー設定に問題があります",
  INTERNAL_ERROR: "サーバー内部でエラーが発生しました",
  NOT_FOUND: "対象データが見つかりません",
  BLOB_UPLOAD_FAILED: "画像アップロードに失敗しました",
};

function hasJapanese(text: string) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

function fallbackMessageByStatus(status: number) {
  if (status === 400) {
    return "リクエスト内容に誤りがあります";
  }
  if (status === 401) {
    return "認証が必要です";
  }
  if (status === 403) {
    return "この操作を実行する権限がありません";
  }
  if (status === 404) {
    return "対象データが見つかりません";
  }
  if (status === 409) {
    return "データの競合が発生しました。再読み込みして再試行してください";
  }
  if (status >= 500) {
    return "サーバー内部でエラーが発生しました";
  }
  return "エラーが発生しました";
}

function toJapaneseMessage(code: string, message: string, status: number) {
  if (ERROR_MESSAGE_JA[code]) {
    return ERROR_MESSAGE_JA[code];
  }
  if (hasJapanese(message)) {
    return message;
  }
  return fallbackMessageByStatus(status);
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message: toJapaneseMessage(code, message, status),
      },
    },
    { status },
  );
}

function isEnvMissingDbUrl(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /Environment variable not found: DATABASE_URL/i.test(error.message);
}

function failPrismaKnown(error: Prisma.PrismaClientKnownRequestError) {
  if (error.code === "P2021") {
    return errorResponse(
      503,
      "DB_NOT_MIGRATED",
      "Database schema is not ready. Run migrations.",
    );
  }

  if (error.code === "P2022") {
    return errorResponse(
      503,
      "DB_SCHEMA_MISMATCH",
      "Database columns are out of sync with the app schema.",
    );
  }

  if (error.code === "P2024") {
    return errorResponse(
      503,
      "DB_POOL_TIMEOUT",
      "Database connection pool timeout. Please retry.",
    );
  }

  if (error.code === "P2025") {
    return errorResponse(404, "NOT_FOUND", "Target record was not found.");
  }

  if (error.code === "P2002") {
    return errorResponse(
      409,
      "UNIQUE_CONSTRAINT",
      "A record with the same unique key already exists.",
    );
  }

  if (error.code === "P2003") {
    return errorResponse(
      409,
      "FK_CONSTRAINT",
      "The requested relation is invalid (foreign key constraint).",
    );
  }

  if (error.code === "P2034") {
    return errorResponse(
      409,
      "TX_CONFLICT",
      "Transaction conflict detected. Please retry.",
    );
  }

  return errorResponse(
    500,
    error.code,
    `Database request failed (${error.code})`,
  );
}

export function fail(error: unknown) {
  if (error instanceof AppError) {
    return errorResponse(error.status, error.code, error.message);
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return errorResponse(503, "DB_UNAVAILABLE", "Database is not reachable");
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return failPrismaKnown(error);
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return errorResponse(503, "DB_TIMEOUT", "Database operation timed out");
  }

  if (isEnvMissingDbUrl(error)) {
    return errorResponse(
      500,
      "SERVER_MISCONFIG",
      "DATABASE_URL is missing in environment variables",
    );
  }

  console.error(error);
  return errorResponse(500, "INTERNAL_ERROR", "Internal server error");
}
