import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { fail, ok } from "@/lib/response";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  businessHoursOnly: z.enum(["true", "false"]).default("true"),
});

type WaitPoint = {
  key: string;
  orderId: string;
  orderNo: number;
  confirmedAt: Date;
  finishedAt: Date;
  waitSeconds: number;
  itemId: string | null;
  menuId: string | null;
  menuName: string | null;
};

function jstDayRange(dateKey: string) {
  const start = new Date(`${dateKey}T00:00:00+09:00`);
  if (Number.isNaN(start.getTime())) {
    throw new Error("Invalid business date");
  }
  return {
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
    chartStart: new Date(`${dateKey}T09:00:00+09:00`),
    chartEnd: new Date(`${dateKey}T18:00:00+09:00`),
  };
}

function tightChartRange(
  hardStart: Date,
  hardEnd: Date,
  lifetimes: Array<{ start: Date; end: Date }>,
) {
  if (lifetimes.length === 0) {
    return { chartStart: hardStart, chartEnd: hardEnd };
  }
  const hourMs = 60 * 60 * 1000;
  const earliest = Math.min(...lifetimes.map((row) => row.start.getTime()));
  const latest = Math.max(...lifetimes.map((row) => row.end.getTime()));
  let startMs = Math.max(
    hardStart.getTime(),
    Math.min(hardEnd.getTime() - hourMs, Math.floor(earliest / hourMs) * hourMs),
  );
  let endMs = Math.min(
    hardEnd.getTime(),
    Math.max(hardStart.getTime() + hourMs, Math.ceil(latest / hourMs) * hourMs),
  );
  if (endMs <= startMs) {
    if (startMs + hourMs <= hardEnd.getTime()) {
      endMs = startMs + hourMs;
    } else {
      startMs = Math.max(hardStart.getTime(), endMs - hourMs);
    }
  }
  return { chartStart: new Date(startMs), chartEnd: new Date(endMs) };
}

function percentile50(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function summaryFor(key: string, label: string, points: WaitPoint[]) {
  const values = points.map((point) => point.waitSeconds);
  const late = values.filter((value) => value > 25 * 60).length;
  const severe = values.filter((value) => value > 40 * 60).length;
  return {
    key,
    label,
    sampleSize: values.length,
    p50Seconds: percentile50(values),
    maxSeconds: values.length > 0 ? Math.max(...values) : null,
    lateRatio: values.length > 0 ? late / values.length : null,
    severeLateRatio: values.length > 0 ? severe / values.length : null,
  };
}

function orderEventAt(raw: unknown, types: string[]) {
  if (!Array.isArray(raw)) return null;
  const matches = raw
    .map((event) => {
      if (!event || typeof event !== "object" || Array.isArray(event)) return null;
      const record = event as Record<string, unknown>;
      if (typeof record.type !== "string" || !types.includes(record.type)) return null;
      if (typeof record.at !== "string") return null;
      const at = new Date(record.at);
      return Number.isNaN(at.getTime()) ? null : at;
    })
    .filter((at): at is Date => at != null);
  return matches.length > 0
    ? new Date(Math.max(...matches.map((at) => at.getTime())))
    : null;
}

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, {
      actorTypes: ["POS", "KITCHEN", "WAITER", "ADMIN"],
    });
    const query = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    );
    const range = jstDayRange(query.date);

    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: range.start, lt: range.end },
      },
      select: {
        id: true,
        orderNo: true,
        createdAt: true,
        confirmedAt: true,
        orderStatus: true,
        paymentStatus: true,
        paymentMethod: true,
        paymentSkipReasonType: true,
        paymentSkipReasonText: true,
        totalPriceJpy: true,
        events: true,
        excludeFromWaitStats: true,
        items: {
          select: {
            id: true,
            menuId: true,
            itemNameSnapshot: true,
            unitPriceJpy: true,
            status: true,
            readyAt: true,
            servedAt: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { orderNo: "asc" }],
      take: 1500,
    });

    const validOrders = orders.filter(
      (order) =>
        order.confirmedAt &&
        (order.paymentStatus === "PAID" || order.paymentStatus === "SKIPPED") &&
        order.orderStatus !== "FAILED" &&
        order.orderStatus !== "CANCELED",
    );

    const menuMap = new Map<
      string,
      { menuId: string; name: string; count: number; salesJpy: number }
    >();
    const salesEvents: Array<{
      at: Date;
      orderId: string;
      orderNo: number;
      menuId: string | null;
      menuName: string | null;
      itemId: string | null;
    }> = [];
    const waitPoints: WaitPoint[] = [];
    const orderLifetimes: Array<{ start: Date; end: Date }> = [];

    for (const order of validOrders) {
      const confirmedAt = order.confirmedAt!;
      salesEvents.push({
        at: confirmedAt,
        orderId: order.id,
        orderNo: order.orderNo,
        menuId: null,
        menuName: null,
        itemId: null,
      });

      const activeItems = order.items.filter((item) => item.status !== "CANCELED");
      const lastKnownAt = activeItems.reduce((latest, item) => {
        const itemLatest = Math.max(
          item.readyAt?.getTime() ?? confirmedAt.getTime(),
          item.servedAt?.getTime() ?? confirmedAt.getTime(),
        );
        return Math.max(latest, itemLatest);
      }, confirmedAt.getTime());
      orderLifetimes.push({ start: confirmedAt, end: new Date(lastKnownAt) });
      for (const item of activeItems) {
        const current = menuMap.get(item.menuId) ?? {
          menuId: item.menuId,
          name: item.itemNameSnapshot,
          count: 0,
          salesJpy: 0,
        };
        current.count += 1;
        current.salesJpy += item.unitPriceJpy;
        menuMap.set(item.menuId, current);
        salesEvents.push({
          at: confirmedAt,
          orderId: order.id,
          orderNo: order.orderNo,
          menuId: item.menuId,
          menuName: item.itemNameSnapshot,
          itemId: item.id,
        });

        if (item.servedAt && !order.excludeFromWaitStats) {
          waitPoints.push({
            key: `menu:${item.menuId}`,
            orderId: order.id,
            orderNo: order.orderNo,
            confirmedAt,
            finishedAt: item.servedAt,
            waitSeconds: Math.max(
              0,
              (item.servedAt.getTime() - confirmedAt.getTime()) / 1000,
            ),
            itemId: item.id,
            menuId: item.menuId,
            menuName: item.itemNameSnapshot,
          });
        }
      }

      const firstServedTimes = activeItems
        .map((item) => item.servedAt)
        .filter((value): value is Date => Boolean(value));
      if (firstServedTimes.length > 0 && !order.excludeFromWaitStats) {
        const finishedAt = new Date(
          Math.min(...firstServedTimes.map((value) => value.getTime())),
        );
        waitPoints.push({
          key: "order:first-serving",
          orderId: order.id,
          orderNo: order.orderNo,
          confirmedAt,
          finishedAt,
          waitSeconds: Math.max(
            0,
            (finishedAt.getTime() - confirmedAt.getTime()) / 1000,
          ),
          itemId: null,
          menuId: null,
          menuName: null,
        });
      }

      if (
        !order.excludeFromWaitStats && activeItems.length > 0 &&
        activeItems.every((item) => item.servedAt != null)
      ) {
        const finishedAt = new Date(
          Math.max(...activeItems.map((item) => item.servedAt!.getTime())),
        );
        waitPoints.push({
          key: "order:complete",
          orderId: order.id,
          orderNo: order.orderNo,
          confirmedAt,
          finishedAt,
          waitSeconds: Math.max(
            0,
            (finishedAt.getTime() - confirmedAt.getTime()) / 1000,
          ),
          itemId: null,
          menuId: null,
          menuName: null,
        });
      }
    }

    const menus = [...menuMap.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "ja"),
    );
    const waitSummaries = [
      summaryFor(
        "order:complete",
        "注文（提供完了）",
        waitPoints.filter((point) => point.key === "order:complete"),
      ),
      summaryFor(
        "order:first-serving",
        "注文（初回提供）",
        waitPoints.filter((point) => point.key === "order:first-serving"),
      ),
      ...menus.map((menu) =>
        summaryFor(
          `menu:${menu.menuId}`,
          menu.name,
          waitPoints.filter((point) => point.key === `menu:${menu.menuId}`),
        ),
      ),
    ];
    const tightRange = query.businessHoursOnly === "true"
      ? tightChartRange(range.chartStart, range.chartEnd, orderLifetimes)
      : { chartStart: range.start, chartEnd: range.end };
    const waitYMaxMinutes = Math.max(
      10,
      Math.ceil(
        Math.max(0, ...waitPoints.map((point) => point.waitSeconds / 60)) / 10,
      ) * 10,
    );

    const paymentIncidents =
      orders.length === 0
        ? []
        : await prisma.paymentIncident.findMany({
            where: { orderId: { in: orders.map((order) => order.id) } },
            select: {
              id: true,
              orderId: true,
              messageJa: true,
              createdAt: true,
              dismissedAt: true,
              order: { select: { orderNo: true } },
            },
            orderBy: { createdAt: "desc" },
          });

    const incidents: Array<{
      id: string;
      orderId: string;
      orderNo: number;
      at: Date;
      severity: "warning" | "danger";
      type: string;
      message: string;
      dismissedAt: Date | null;
    }> = paymentIncidents.map((incident) => ({
      id: incident.id,
      orderId: incident.orderId,
      orderNo: incident.order.orderNo,
      at: incident.createdAt,
      severity: "danger",
      type: "PAYMENT_INCIDENT",
      message: incident.messageJa,
      dismissedAt: incident.dismissedAt,
    }));

    for (const order of orders) {
      if (order.orderStatus === "FAILED" || order.orderStatus === "CANCELED") {
        incidents.push({
          id: `failed:${order.id}`,
          orderId: order.id,
          orderNo: order.orderNo,
          at:
            orderEventAt(order.events, ["PAYMENT_FAILED", "ORDER_FAILED"]) ??
            order.createdAt,
          severity: "danger",
          type: "ORDER_FAILED",
          message: "失敗・取消のため売上と待ち時間集計から除外",
          dismissedAt: null,
        });
      } else if (order.paymentStatus === "AWAITING") {
        incidents.push({
          id: `awaiting:${order.id}`,
          orderId: order.id,
          orderNo: order.orderNo,
          at: order.createdAt,
          severity: "warning",
          type: "PAYMENT_AWAITING",
          message: "決済確認待ちのため売上集計から除外",
          dismissedAt: null,
        });
      } else if (order.paymentMethod === "PAYMENT_SKIPPED") {
        const reason = [order.paymentSkipReasonType, order.paymentSkipReasonText]
          .filter(Boolean)
          .join(" / ");
        incidents.push({
          id: `skipped:${order.id}`,
          orderId: order.id,
          orderNo: order.orderNo,
          at: order.confirmedAt ?? order.createdAt,
          severity: "warning",
          type: "PAYMENT_SKIPPED",
          message: `決済スキップ${reason ? `（${reason}）` : ""}。売上には含む`,
          dismissedAt: null,
        });
      }
    }
    incidents.sort((a, b) => b.at.getTime() - a.at.getTime());

    return ok({
      date: query.date,
      timezone: "Asia/Tokyo",
      range,
      chartRange: tightRange,
      totals: {
        orderCount: validOrders.length,
        itemCount: menus.reduce((total, menu) => total + menu.count, 0),
        salesJpy: validOrders.reduce(
          (total, order) => total + order.totalPriceJpy,
          0,
        ),
        failedOrCanceledCount: orders.filter(
          (order) =>
            order.orderStatus === "FAILED" || order.orderStatus === "CANCELED",
        ).length,
        unconfirmedCount: orders.filter(
          (order) => !order.confirmedAt || order.paymentStatus === "AWAITING",
        ).length,
      },
      menus,
      salesEvents,
      wait: {
        summaries: waitSummaries,
        points: waitPoints,
        yMaxMinutes: waitYMaxMinutes,
      },
      incidents,
    });
  } catch (error) {
    return fail(error);
  }
}
