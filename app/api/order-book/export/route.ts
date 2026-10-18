import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail } from "@/lib/response";
import { deriveOrderProcessingTrace } from "@/lib/domain/order-processing-trace";
import { AGE_GROUPS, parseAgeRangesToCounts } from "@/lib/age-groups";

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function normalizeMenuLabel(label: string | null | undefined) {
  const trimmed = (label ?? "").trim();
  return trimmed.length > 0 ? trimmed : "不明メニュー";
}

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, {
      actorTypes: ["POS", "KITCHEN", "WAITER", "ADMIN"],
    });

    const [orders, menus] = await Promise.all([
      prisma.order.findMany({
        include: {
          items: {
            select: {
              itemNameSnapshot: true,
              servedAt: true,
            },
          },
        },
        take: 1000,
        orderBy: {
          createdAt: "desc",
        },
      }),
      prisma.menu.findMany({
        select: {
          name: true,
          displayOrder: true,
        },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      }),
    ]);

    const menuLabelSet = new Set<string>();
    for (const menu of menus) {
      menuLabelSet.add(normalizeMenuLabel(menu.name));
    }
    for (const order of orders) {
      for (const item of order.items) {
        menuLabelSet.add(normalizeMenuLabel(item.itemNameSnapshot));
      }
    }
    const menuColumns = [...menuLabelSet].sort((a, b) => a.localeCompare(b, "ja"));

    const ageColumns = AGE_GROUPS.map((group) => group.csvColumn);
    const lines: string[] = [];

    lines.push(
      [
        "order_no",
        "created_at",
        "confirmed_at",
        "completed_at",
        "canceled_at",
        "cancel_reason_type",
        "cancel_reason_text",
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
        ...menuColumns,
      ].join(","),
    );

    for (const order of orders) {
      const trace = deriveOrderProcessingTrace({ createdAt: order.createdAt, events: order.events });
      const ageCounts = parseAgeRangesToCounts(order.ageRangesJson);
      const menuCounts = new Map<string, number>();
      for (const item of order.items) {
        const label = normalizeMenuLabel(item.itemNameSnapshot);
        menuCounts.set(label, (menuCounts.get(label) ?? 0) + 1);
      }

      lines.push(
        [
          order.orderNo,
          order.createdAt.toISOString(),
          order.confirmedAt?.toISOString() ?? "",
          (() => {
            const completedAtMs = Math.max(
              0,
              ...order.items
                .map((item) => item.servedAt?.getTime() ?? 0)
                .filter((value) => value > 0),
            );
            return completedAtMs > 0 ? new Date(completedAtMs).toISOString() : "";
          })(),
          order.canceledAt?.toISOString() ?? "",
          order.orderStatus === "CANCELED" ? trace.failureReasonType : "",
          order.orderStatus === "CANCELED" ? trace.failureReasonText : "",
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
          ...menuColumns.map((menuLabel) => menuCounts.get(menuLabel) ?? 0),
        ]
          .map(csvEscape)
          .join(","),
      );
    }

    const body = `\uFEFF${lines.join("\n")}`;
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="order_book_order_wise_${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    return fail(error);
  }
}
