import { ApiError } from "../client";

// Menu availability/cap rejections roll back POST /api/orders before creation.
// Other conflicts and uncertain network/server failures must retain recovery.
export function isDefinitiveOrderRejection(error: unknown): boolean {
  return error instanceof ApiError && (
    [400, 403, 404].includes(error.status) ||
    (error.status === 409 && ["MENU_CAP_REACHED", "MENU_UNAVAILABLE"].includes(error.code ?? ""))
  );
}
