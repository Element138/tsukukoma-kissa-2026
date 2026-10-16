import { createHmac, timingSafeEqual } from "node:crypto";
export function verifySquareWebhook(raw: string, signature: string | null, key: string | undefined, notificationUrl: string | undefined) {
  if (!signature || !key || !notificationUrl) return false;
  const expected = createHmac("sha256", key).update(notificationUrl + raw).digest("base64");
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
