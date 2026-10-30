import { ApiError } from "../client";

// A cap rejection rolls back POST /api/orders before an order is created.
// Other conflicts and uncertain network/server failures must retain recovery.
export function isDefinitiveOrderRejection(error: unknown): boolean {
  return error instanceof ApiError && (
    [400, 403, 404].includes(error.status) ||
    (error.status === 409 && error.code === "MENU_CAP_REACHED")
  );
}
