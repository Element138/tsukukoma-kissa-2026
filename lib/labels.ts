export const ACTOR_TYPE_LABEL: Record<string, string> = {
  POS: "POS",
  KITCHEN: "\u30ad\u30c3\u30c1\u30f3",
  WAITER: "\u914d\u81a3",
  MENU_DISPLAY: "\u30e1\u30cb\u30e5\u30fc\u8868\u793a",
  ADMIN: "\u7ba1\u7406"
};

export const AVAILABILITY_LABEL: Record<string, string> = {
  AVAILABLE: "\u8ca9\u58f2\u4e2d",
  PAUSED: "\u4e00\u6642\u505c\u6b62",
  SOLD_OUT: "\u58f2\u308a\u5207\u308c"
};

export const FULFILLMENT_LABEL: Record<string, string> = {
  DINE_IN: "\u5e97\u5185",
  TAKEOUT: "\u6301\u3061\u5e30\u308a"
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "\u73fe\u91d1",
  SQUARE: "Square",
  PAYMENT_SKIPPED: "\u6c7a\u6e08\u30b9\u30ad\u30c3\u30d7"
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PAID: "\u652f\u6255\u6e08\u307f",
  FAILED: "\u5931\u6557",
  AWAITING: "\u78ba\u8a8d\u5f85\u3061",
  CANCELED: "\u53d6\u6d88",
  SKIPPED: "\u30b9\u30ad\u30c3\u30d7"
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "\u4fdd\u7559",
  PREPARING: "\u8abf\u7406\u4e2d",
  AWAITING_SERVING: "\u63d0\u4f9b\u5f85\u3061",
  COMPLETED: "\u5b8c\u4e86",
  CANCELED: "\u53d6\u6d88"
};

export const ORDER_ITEM_STATUS_LABEL: Record<string, string> = {
  QUEUED: "\u5f85\u3061",
  READY: "\u63d0\u4f9b\u53ef",
  SERVED: "\u63d0\u4f9b\u6e08",
  CANCELED: "\u53d6\u6d88"
};

export const AUDIT_RESULT_LABEL: Record<string, string> = {
  SUCCESS: "\u6210\u529f",
  FAILURE: "\u5931\u6557"
};

export const PAYMENT_SKIP_REASON_LABEL: Record<string, string> = {
  TEST: "\u30c6\u30b9\u30c8",
  DEVICE_ERROR: "\u7aef\u672b\u30a8\u30e9\u30fc",
  NETWORK_ERROR: "\u901a\u4fe1\u30a8\u30e9\u30fc",
  OTHER: "\u305d\u306e\u4ed6"
};

export const SESSION_FAILURE_LABEL: Record<string, string> = {
  SESSION_MISSING: "\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059",
  SESSION_INVALID: "\u30bb\u30c3\u30b7\u30e7\u30f3\u304c\u7121\u52b9\u3067\u3059",
  SESSION_REVOKED: "\u30bb\u30c3\u30b7\u30e7\u30f3\u304c\u7121\u52b9\u5316\u3055\u308c\u307e\u3057\u305f",
  SESSION_EXPIRED: "\u30bb\u30c3\u30b7\u30e7\u30f3\u306e\u6709\u52b9\u671f\u9650\u304c\u5207\u308c\u307e\u3057\u305f",
  ACTOR_INACTIVE: "\u30a2\u30ab\u30a6\u30f3\u30c8\u304c\u7121\u52b9\u5316\u3055\u308c\u3066\u3044\u307e\u3059",
  FORBIDDEN: "\u3053\u306e\u753b\u9762\u3092\u5229\u7528\u3059\u308b\u6a29\u9650\u304c\u3042\u308a\u307e\u305b\u3093",
  UNAUTHORIZED: "\u8a8d\u8a3c\u304c\u5fc5\u8981\u3067\u3059",
  LOGOUT_MANUAL: "\u30ed\u30b0\u30a2\u30a6\u30c8\u3057\u307e\u3057\u305f"
};

export function labelOf(map: Record<string, string>, value: string | null | undefined, fallback = "-") {
  if (!value) {
    return fallback;
  }
  return map[value] ?? value;
}
