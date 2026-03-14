import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail } from "@/lib/response";
import { AGE_GROUPS, parseAgeRangesToCounts } from "@/lib/age-groups";

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
    const format = req.nextUrl.searchParams.get("format") === "item" ? "item" : "order";

    const orders = await prisma.order.findMany({
      include: {
        items: {
          include: {
            menu: {
              select: {
                categoryId: true
              }
            }
          }
        }
      },
      take: 1000,
      orderBy: {
        createdAt: "desc"
      }
    });

    const ageColumns = AGE_GROUPS.map((group) => group.csvColumn);
    const lines: string[] = [];

    if (format === "order") {
      lines.push(
        [
          "order_no",
          "created_at",
          "confirmed_at",
          "fulfillment_type",
          "table_no",
          "party_size",
          "payment_method",
          "payment_status",
          "order_status",
          "total_price_jpy",
          "item_count",
          ...ageColumns,
          "special_note",
        ].join(","),
      );

      for (const order of orders) {
        const ageCounts = parseAgeRangesToCounts(order.ageRangesJson);
        lines.push(
          [
            order.orderNo,
            order.createdAt.toISOString(),
            order.confirmedAt?.toISOString() ?? "",
            order.fulfillmentType,
            order.tableNo ?? "",
            order.partySize,
            order.paymentMethod,
            order.paymentStatus,
            order.orderStatus,
            order.totalPriceJpy,
            order.items.length,
            ...AGE_GROUPS.map((group) => ageCounts[group.key]),
            order.specialNote ?? "",
          ]
            .map(csvEscape)
            .join(","),
        );
      }
    } else {
      lines.push(
        [
          "order_no",
          "created_at",
          "confirmed_at",
          "fulfillment_type",
          "table_no",
          "party_size",
          "payment_method",
          "payment_status",
          "order_status",
          ...ageColumns,
          "order_special_note",
          "item_id",
          "menu_id",
          "menu_category_id",
          "item_name",
          "item_status",
          "unit_price_jpy",
          "kitchen_id",
          "ready_at",
          "served_at",
        ].join(","),
      );

      for (const order of orders) {
        const ageCounts = parseAgeRangesToCounts(order.ageRangesJson);
        for (const item of order.items) {
          lines.push(
            [
              order.orderNo,
              order.createdAt.toISOString(),
              order.confirmedAt?.toISOString() ?? "",
              order.fulfillmentType,
              order.tableNo ?? "",
              order.partySize,
              order.paymentMethod,
              order.paymentStatus,
              order.orderStatus,
              ...AGE_GROUPS.map((group) => ageCounts[group.key]),
              order.specialNote ?? "",
              item.id,
              item.menuId,
              item.menu.categoryId,
              item.itemNameSnapshot,
              item.status,
              item.unitPriceJpy,
              item.kitchenId ?? "",
              item.readyAt?.toISOString() ?? "",
              item.servedAt?.toISOString() ?? "",
            ]
              .map(csvEscape)
              .join(","),
          );
        }
      }
    }

    const body = `\uFEFF${lines.join("\n")}`;
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="order_book_${format}_wise_${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    return fail(error);
  }
}


