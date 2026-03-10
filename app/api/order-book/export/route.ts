import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail } from "@/lib/response";

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, { actorTypes: ["POS", "KITCHEN", "WAITER", "ADMIN"] });

    const orders = await prisma.order.findMany({
      include: {
        items: true
      },
      take: 1000,
      orderBy: {
        createdAt: "desc"
      }
    });

    const lines = [
      [
        "order_no",
        "created_at",
        "confirmed_at",
        "fulfillment_type",
        "table_no",
        "payment_method",
        "payment_status",
        "order_status",
        "total_price_jpy",
        "item_count",
        "special_note"
      ].join(",")
    ];

    for (const o of orders) {
      lines.push(
        [
          o.orderNo,
          o.createdAt.toISOString(),
          o.confirmedAt?.toISOString() ?? "",
          o.fulfillmentType,
          o.tableNo ?? "",
          o.paymentMethod,
          o.paymentStatus,
          o.orderStatus,
          o.totalPriceJpy,
          o.items.length,
          o.specialNote ?? ""
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    const body = lines.join("\n");
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="order_book_${Date.now()}.csv"`
      }
    });
  } catch (error) {
    return fail(error);
  }
}


