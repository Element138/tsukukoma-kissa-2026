export const ACTOR_TYPE_LABEL: Record<string, string> = {
  POS: "POS",
  KITCHEN: "キッチン",
  WAITER: "ウェイター",
  MENU_DISPLAY: "メニュー表示",
  ADMIN: "管理者",
};

export const AVAILABILITY_LABEL: Record<string, string> = {
  AVAILABLE: "販売中",
  INCREASED_WAIT: "待ち長し",
  PAUSED: "販売停止中",
  SOLD_OUT: "売り切れ",
};

export const FULFILLMENT_LABEL: Record<string, string> = {
  DINE_IN: "店内",
  TAKEOUT: "持ち帰り",
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "現金",
  SQUARE: "Square",
  PAYMENT_SKIPPED: "決済スキップ",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PAID: "支払済み",
  FAILED: "失敗",
  AWAITING: "確認待ち",
  CANCELED: "失敗(旧取消)",
  SKIPPED: "スキップ",
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "保留",
  PREPARING: "調理中",
  AWAITING_SERVING: "提供待ち",
  COMPLETED: "完了",
  FAILED: "失敗",
  CANCELED: "失敗(旧取消)",
};

export const ORDER_ITEM_STATUS_LABEL: Record<string, string> = {
  QUEUED: "調理待ち",
  READY: "提供待ち",
  SERVED: "提供済み",
  CANCELED: "取消",
};

export const AUDIT_RESULT_LABEL: Record<string, string> = {
  SUCCESS: "成功",
  FAILURE: "失敗",
};

export const PAYMENT_SKIP_REASON_LABEL: Record<string, string> = {
  TEST: "テスト",
  DEVICE_ERROR: "端末エラー",
  NETWORK_ERROR: "通信エラー",
  OTHER: "その他",
};

export const SESSION_FAILURE_LABEL: Record<string, string> = {
  SESSION_MISSING: "ログインが必要です",
  SESSION_INVALID: "セッションが無効です",
  SESSION_REVOKED: "セッションが無効化されました",
  SESSION_EXPIRED: "セッションの有効期限が切れました",
  ACTOR_INACTIVE: "アカウントが無効化されています",
  FORBIDDEN: "この画面を利用する権限がありません",
  UNAUTHORIZED: "認証が必要です",
  LOGOUT_MANUAL: "ログアウトしました",
};

export function labelOf(
  map: Record<string, string>,
  value: string | null | undefined,
  fallback = "-",
) {
  if (!value) {
    return fallback;
  }
  return map[value] ?? value;
}
