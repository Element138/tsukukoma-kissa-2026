import crypto from "node:crypto";

export function createSquareAppSwitchRequest(params: {
  orderId: string;
  orderNo: number;
  amountJpy: number;
  callbackUrl: string;
  note?: string;
}) {
  const requestId = crypto.randomUUID();
  const deepLink =
    `square-commerce-v1://payment/create?` +
    `data=${encodeURIComponent(
      JSON.stringify({
        amount_money: {
          amount: params.amountJpy,
          currency_code: "JPY"
        },
        options: {
          supported_tender_types: ["CREDIT_CARD", "CASH", "OTHER"],
          auto_return: true
        },
        client_id: process.env.SQUARE_APP_ID ?? "",
        state: params.orderId,
        notes: params.note ?? `KISSa order #${params.orderNo}`,
        callback_url: params.callbackUrl
      })
    )}`;

  return {
    requestId,
    deepLink
  };
}

export function verifySquareCallbackSignature(rawBody: string, signature: string | null): boolean {
  const key = process.env.SQUARE_CALLBACK_SIGNING_KEY;
  if (!key) {
    return true;
  }
  if (!signature) {
    return false;
  }

  const expected = crypto.createHmac("sha256", key).update(rawBody).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}


