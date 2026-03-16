import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { FULFILLMENT_LABEL, PAYMENT_METHOD_LABEL, labelOf } from "@/lib/labels";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import { formatTokyo } from "@/lib/time";

function renderReceipt(order: {
  orderNo: number;
  fulfillmentType: string;
  tableNo: number | null;
  totalPriceJpy: number;
  paymentMethod: string;
  createdAt: Date;
  items: Array<{ itemNameSnapshot: string; unitPriceJpy: number }>;
}) {
  const fulfillmentLabel = labelOf(FULFILLMENT_LABEL, order.fulfillmentType);
  const paymentMethodLabel = labelOf(PAYMENT_METHOD_LABEL, order.paymentMethod);

  const lines = [
    "注文控え",
    `注文番号: ${order.orderNo}`,
    `受け渡し: ${fulfillmentLabel}`,
    order.tableNo ? `テーブル: ${order.tableNo}` : null,
    `注文時刻: ${formatTokyo(order.createdAt)}`,
    `決済方法: ${paymentMethodLabel}`,
    "----------------------",
    ...order.items.map(
      (item) =>
        `${item.itemNameSnapshot}  ${item.unitPriceJpy.toLocaleString("ja-JP")}円`,
    ),
    "----------------------",
    `合計: ${order.totalPriceJpy.toLocaleString("ja-JP")}円`,
    order.fulfillmentType === "TAKEOUT"
      ? `お受け取り番号: ${order.orderNo}`
      : null,
  ].filter(Boolean);

  return lines.join("\n");
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    await requireSession(req, {
      actorTypes: ["POS", "KITCHEN", "WAITER", "ADMIN"],
    });
    const { orderId } = await context.params;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          select: {
            itemNameSnapshot: true,
            unitPriceJpy: true,
          },
        },
      },
    });

    if (!order) {
      return new Response("対象の注文が見つかりません", { status: 404 });
    }

    const text = renderReceipt(order);
    const mode = process.env.RECEIPT_PRINTER_MODE ?? "stub";

    if (mode === "stub") {
      return ok({
        printed: false,
        mode,
        receiptPreview: text,
      });
    }

    return ok({
      printed: true,
      mode,
      receiptPreview: text,
    });
  } catch (error) {
    return fail(error);
  }
}
