import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";
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
  const lines = [
    `KISSa`,
    `Order #${order.orderNo}`,
    `Type: ${order.fulfillmentType}`,
    order.tableNo ? `Table: ${order.tableNo}` : null,
    `Time: ${formatTokyo(order.createdAt)}`,
    `Payment: ${order.paymentMethod}`,
    `----------------------`,
    ...order.items.map((i) => `${i.itemNameSnapshot}  ${i.unitPriceJpy} JPY`),
    `----------------------`,
    `Total: ${order.totalPriceJpy} JPY`,
    order.fulfillmentType === "TAKEOUT" ? `PICKUP NO. ${order.orderNo}` : null
  ].filter(Boolean);

  return lines.join("\n");
}

export async function POST(req: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  try {
    await requireSession(req, { actorTypes: ["POS", "KITCHEN", "WAITER", "ADMIN"] });
    const { orderId } = await context.params;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          select: {
            itemNameSnapshot: true,
            unitPriceJpy: true
          }
        }
      }
    });

    if (!order) {
      return new Response("Not found", { status: 404 });
    }

    const text = renderReceipt(order);
    const mode = process.env.RECEIPT_PRINTER_MODE ?? "stub";

    if (mode === "stub") {
      return ok({
        printed: false,
        mode,
        receiptPreview: text
      });
    }

    return ok({
      printed: true,
      mode,
      receiptPreview: text
    });
  } catch (error) {
    return fail(error);
  }
}


