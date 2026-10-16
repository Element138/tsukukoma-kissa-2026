import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { fail } from "@/lib/response";
import { renderReceiptPdf } from "@/lib/receipt/render-pdf";
import type { ReceiptLineItem } from "@/lib/receipt/types";
import { requireSession } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({
  size: z.enum(["large", "small"]).default("large"),
});

const fontBytesPromise = Promise.all([
  readFile(path.join(process.cwd(), "public", "fonts", "Lato-Bold.ttf")),
  readFile(path.join(process.cwd(), "public", "receipt", "logo.png")),
  readFile(
    path.join(
      process.cwd(),
      "public",
      "fonts",
      "NotoSansJP-Regular.otf",
    ),
  ),
  readFile(
    path.join(
      process.cwd(),
      "public",
      "fonts",
      "NotoSansJP-Bold.otf",
    ),
  ),
]);

function bundleOrderItems(
  items: Array<{ itemNameSnapshot: string; unitPriceJpy: number }>,
) {
  const bundled = new Map<string, ReceiptLineItem>();

  for (const item of items) {
    const key = `${item.itemNameSnapshot}\u0000${item.unitPriceJpy}`;
    const current = bundled.get(key);
    if (current) {
      current.quantity += 1;
    } else {
      bundled.set(key, {
        name: item.itemNameSnapshot,
        unitPriceJpy: item.unitPriceJpy,
        quantity: 1,
      });
    }
  }

  return [...bundled.values()];
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    await requireSession(req, {
      actorTypes: ["POS", "KITCHEN", "WAITER", "ADMIN"],
    });
    const { orderId } = await context.params;
    const query = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    );

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderNo: true,
        createdAt: true,
        confirmedAt: true,
        fulfillmentType: true,
        tableNo: true,
        paymentMethod: true,
        paymentStatus: true,
        orderStatus: true,
        totalPriceJpy: true,
        items: {
          select: {
            itemNameSnapshot: true,
            unitPriceJpy: true,
          },
          orderBy: { id: "asc" },
        },
      },
    });

    if (!order) {
      throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
    }
    if (
      (order.paymentStatus !== "PAID" && order.paymentStatus !== "SKIPPED") ||
      order.orderStatus === "FAILED" ||
      order.orderStatus === "CANCELED"
    ) {
      throw new AppError(
        409,
        "RECEIPT_NOT_AVAILABLE",
        "会計が完了した注文のみレシートを発行できます",
      );
    }

    const [orderNumberFontBytes, logoBytes, regularFontBytes, boldFontBytes] = await fontBytesPromise;
    const pdfBytes = await renderReceiptPdf({
      renderOrigin: req.nextUrl.origin,
      size: query.size,
      regularFontBytes,
      boldFontBytes,
      orderNumberFontBytes,
      logoBytes,
      data: {
        orderNo: order.orderNo,
        transactionAt: order.confirmedAt ?? order.createdAt,
        fulfillmentType: order.fulfillmentType,
        tableNo: order.tableNo,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        totalPriceJpy: order.totalPriceJpy,
        items: bundleOrderItems(order.items),
      },
    });

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="receipt-${order.orderNo}-${query.size}.pdf"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
