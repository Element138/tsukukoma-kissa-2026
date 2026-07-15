import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/response";
import { requireSession } from "@/lib/server/auth";
import {
  SALES_LATE_DANGER_SECONDS,
  SALES_LATE_WARN_SECONDS,
} from "@/lib/experience-thresholds";
import { tokyoDateKey, tokyoDayRangeUtcFromDateKey } from "@/lib/time";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

type WaitMeasurement = {
  id: string;
  orderId: string;
  orderNo: number;
  label: string;
  menuId?: string;
  menuName?: string;
  seconds: number;
  hour: number;
  salesJpy: number;
};

type Accumulator = {
  count: number;
  salesJpy: number;
};

const WAIT_BUCKETS = [
  { key: "0-5", label: "0-5分", min: 0, max: 5 * 60 },
  { key: "5-10", label: "5-10分", min: 5 * 60, max: 10 * 60 },
  { key: "10-15", label: "10-15分", min: 10 * 60, max: 15 * 60 },
  { key: "15-20", label: "15-20分", min: 15 * 60, max: 20 * 60 },
  { key: "20-25", label: "20-25分", min: 20 * 60, max: 25 * 60 },
  { key: "25-40", label: "25-40分", min: 25 * 60, max: 40 * 60 },
  { key: "40+", label: "40分+", min: 40 * 60, max: Number.POSITIVE_INFINITY },
];

function isRevenueOrder(orderStatus: string) {
  return orderStatus !== "FAILED" && orderStatus !== "CANCELED";
}

function isSoldItem(status: string) {
  return status === "QUEUED" || status === "READY" || status === "SERVED";
}

function secondsBetween(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}

function tokyoHour(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? "0");
}

function ratio(count: number, total: number) {
  return total === 0 ? 0 : count / total;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function waitStats(measurements: WaitMeasurement[]) {
  const values = measurements.map((row) => row.seconds);
  const total = values.reduce((sum, value) => sum + value, 0);
  const warnCount = values.filter((value) => value > SALES_LATE_WARN_SECONDS).length;
  const dangerCount = values.filter((value) => value > SALES_LATE_DANGER_SECONDS).length;

  return {
    count: values.length,
    averageSeconds: values.length === 0 ? null : Math.round(total / values.length),
    p50Seconds: percentile(values, 50),
    p90Seconds: percentile(values, 90),
    maxSeconds: values.length === 0 ? null : Math.max(...values),
    lateWarnCount: warnCount,
    lateDangerCount: dangerCount,
    lateWarnRatio: ratio(warnCount, values.length),
    lateDangerRatio: ratio(dangerCount, values.length),
  };
}

function distribution(measurements: WaitMeasurement[]) {
  return WAIT_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: measurements.filter(
      (row) => row.seconds >= bucket.min && row.seconds < bucket.max,
    ).length,
  }));
}

function hourlyWait(measurements: WaitMeasurement[]) {
  return Array.from({ length: 24 }, (_, hour) => {
    const rows = measurements.filter((row) => row.hour === hour);
    return {
      hour,
      count: rows.length,
      averageSeconds: waitStats(rows).averageSeconds,
      p90Seconds: waitStats(rows).p90Seconds,
    };
  });
}

function addToAccumulator(map: Map<string, Accumulator>, key: string, salesJpy: number) {
  const current = map.get(key) ?? { count: 0, salesJpy: 0 };
  current.count += 1;
  current.salesJpy += salesJpy;
  map.set(key, current);
}

export async function GET(req: NextRequest) {
  try {
    await requireSession(req, {
      actorTypes: ["POS", "KITCHEN", "WAITER", "ADMIN"],
    });

    const query = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    );
    const dateKey = query.date ?? tokyoDateKey();
    const range = tokyoDayRangeUtcFromDateKey(dateKey);
    const now = new Date();

    const [orders, incidents] = await Promise.all([
      prisma.order.findMany({
        where: {
          createdAt: {
            gte: range.start,
            lt: range.end,
          },
        },
        include: {
          items: {
            include: {
              kitchenActor: {
                select: {
                  id: true,
                  label: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
        take: 2000,
      }),
      prisma.paymentIncident.findMany({
        where: {
          createdAt: {
            gte: range.start,
            lt: range.end,
          },
        },
        select: {
          id: true,
          orderId: true,
          messageJa: true,
          dismissedAt: true,
          createdAt: true,
          order: {
            select: {
              orderNo: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
    ]);

    const revenueOrders = orders.filter((order) => isRevenueOrder(order.orderStatus));
    const completedOrderWaits: WaitMeasurement[] = [];
    const completedItemWaits: WaitMeasurement[] = [];
    const activeOrderRisks: WaitMeasurement[] = [];
    const activeItemRisks: WaitMeasurement[] = [];
    const paymentMix = new Map<string, Accumulator>();
    const fulfillmentMix = new Map<string, Accumulator>();
    const hourlySales = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      salesJpy: 0,
      orderCount: 0,
      itemCount: 0,
    }));

    type MenuRow = {
      menuId: string;
      name: string;
      units: number;
      salesJpy: number;
      completedItemWaits: number[];
      productionWaits: number[];
      handoffWaits: number[];
      activeItemCount: number;
      lateWarnCount: number;
      lateDangerCount: number;
    };
    const menuMap = new Map<string, MenuRow>();

    for (const order of revenueOrders) {
      const soldItems = order.items.filter((item) => isSoldItem(item.status));
      const hour = tokyoHour(order.createdAt);
      hourlySales[hour].salesJpy += order.totalPriceJpy;
      hourlySales[hour].orderCount += 1;
      hourlySales[hour].itemCount += soldItems.length;
      addToAccumulator(paymentMix, order.paymentMethod, order.totalPriceJpy);
      addToAccumulator(fulfillmentMix, order.fulfillmentType, order.totalPriceJpy);

      const servedTimestamps = soldItems
        .map((item) => item.servedAt)
        .filter((servedAt): servedAt is Date => Boolean(servedAt));
      const finalServedAt =
        servedTimestamps.length > 0
          ? new Date(Math.max(...servedTimestamps.map((servedAt) => servedAt.getTime())))
          : null;

      if (order.confirmedAt && order.orderStatus === "COMPLETED" && finalServedAt) {
        completedOrderWaits.push({
          id: order.id,
          orderId: order.id,
          orderNo: order.orderNo,
          label: `注文 #${order.orderNo}`,
          seconds: secondsBetween(order.confirmedAt, finalServedAt),
          hour: tokyoHour(order.confirmedAt),
          salesJpy: order.totalPriceJpy,
        });
      } else if (order.confirmedAt) {
        activeOrderRisks.push({
          id: order.id,
          orderId: order.id,
          orderNo: order.orderNo,
          label: `注文 #${order.orderNo}`,
          seconds: secondsBetween(order.confirmedAt, now),
          hour: tokyoHour(order.confirmedAt),
          salesJpy: order.totalPriceJpy,
        });
      }

      for (const item of soldItems) {
        const menuRow = menuMap.get(item.menuId) ?? {
          menuId: item.menuId,
          name: item.itemNameSnapshot,
          units: 0,
          salesJpy: 0,
          completedItemWaits: [],
          productionWaits: [],
          handoffWaits: [],
          activeItemCount: 0,
          lateWarnCount: 0,
          lateDangerCount: 0,
        };
        menuRow.units += 1;
        menuRow.salesJpy += item.unitPriceJpy;

        if (order.confirmedAt && item.servedAt) {
          const itemWaitSeconds = secondsBetween(order.confirmedAt, item.servedAt);
          menuRow.completedItemWaits.push(itemWaitSeconds);
          if (itemWaitSeconds > SALES_LATE_WARN_SECONDS) {
            menuRow.lateWarnCount += 1;
          }
          if (itemWaitSeconds > SALES_LATE_DANGER_SECONDS) {
            menuRow.lateDangerCount += 1;
          }
          completedItemWaits.push({
            id: item.id,
            orderId: order.id,
            orderNo: order.orderNo,
            label: `${item.itemNameSnapshot} / 注文 #${order.orderNo}`,
            menuId: item.menuId,
            menuName: item.itemNameSnapshot,
            seconds: itemWaitSeconds,
            hour: tokyoHour(order.confirmedAt),
            salesJpy: item.unitPriceJpy,
          });
        } else if (order.confirmedAt && item.status !== "SERVED") {
          menuRow.activeItemCount += 1;
          activeItemRisks.push({
            id: item.id,
            orderId: order.id,
            orderNo: order.orderNo,
            label: `${item.itemNameSnapshot} / 注文 #${order.orderNo}`,
            menuId: item.menuId,
            menuName: item.itemNameSnapshot,
            seconds: secondsBetween(order.confirmedAt, now),
            hour: tokyoHour(order.confirmedAt),
            salesJpy: item.unitPriceJpy,
          });
        }

        if (order.confirmedAt && item.readyAt) {
          menuRow.productionWaits.push(secondsBetween(order.confirmedAt, item.readyAt));
        }
        if (item.readyAt && item.servedAt) {
          menuRow.handoffWaits.push(secondsBetween(item.readyAt, item.servedAt));
        }

        menuMap.set(item.menuId, menuRow);
      }
    }

    const menuRows = [...menuMap.values()]
      .map((row) => {
        const completedMeasurements = row.completedItemWaits.map((seconds, index) => ({
          id: `${row.menuId}-${index}`,
          orderId: "",
          orderNo: 0,
          label: row.name,
          menuId: row.menuId,
          menuName: row.name,
          seconds,
          hour: 0,
          salesJpy: 0,
        }));
        return {
          menuId: row.menuId,
          name: row.name,
          units: row.units,
          salesJpy: row.salesJpy,
          completedItemCount: row.completedItemWaits.length,
          activeItemCount: row.activeItemCount,
          averageWaitSeconds: waitStats(completedMeasurements).averageSeconds,
          p90WaitSeconds: waitStats(completedMeasurements).p90Seconds,
          maxWaitSeconds:
            row.completedItemWaits.length === 0 ? null : Math.max(...row.completedItemWaits),
          averageProductionSeconds:
            row.productionWaits.length === 0
              ? null
              : Math.round(
                  row.productionWaits.reduce((sum, value) => sum + value, 0) /
                    row.productionWaits.length,
                ),
          averageHandoffSeconds:
            row.handoffWaits.length === 0
              ? null
              : Math.round(
                  row.handoffWaits.reduce((sum, value) => sum + value, 0) /
                    row.handoffWaits.length,
                ),
          lateWarnCount: row.lateWarnCount,
          lateDangerCount: row.lateDangerCount,
          lateWarnRatio: ratio(row.lateWarnCount, row.completedItemWaits.length),
          lateDangerRatio: ratio(row.lateDangerCount, row.completedItemWaits.length),
        };
      })
      .sort((a, b) => b.salesJpy - a.salesJpy || b.units - a.units);

    const totalSalesJpy = revenueOrders.reduce(
      (sum, order) => sum + order.totalPriceJpy,
      0,
    );
    const totalItemCount = revenueOrders.reduce(
      (sum, order) => sum + order.items.filter((item) => isSoldItem(item.status)).length,
      0,
    );

    const topLateOrders = [...completedOrderWaits, ...activeOrderRisks]
      .filter((row) => row.seconds > SALES_LATE_WARN_SECONDS)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 12);
    const topLateItems = [...completedItemWaits, ...activeItemRisks]
      .filter((row) => row.seconds > SALES_LATE_WARN_SECONDS)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 12);

    return ok({
      dateKey,
      range: {
        from: range.start,
        to: range.end,
      },
      generatedAt: now,
      thresholds: {
        lateWarnSeconds: SALES_LATE_WARN_SECONDS,
        lateDangerSeconds: SALES_LATE_DANGER_SECONDS,
      },
      totals: {
        salesJpy: totalSalesJpy,
        orderCount: revenueOrders.length,
        itemCount: totalItemCount,
        averageTicketJpy:
          revenueOrders.length === 0 ? 0 : Math.round(totalSalesJpy / revenueOrders.length),
        failedCount: orders.filter((order) => order.orderStatus === "FAILED").length,
        canceledCount: orders.filter((order) => order.orderStatus === "CANCELED").length,
        activeOrderCount: activeOrderRisks.length,
        incidentCount: incidents.length,
      },
      mixes: {
        payment: [...paymentMix.entries()].map(([key, value]) => ({
          key,
          ...value,
        })),
        fulfillment: [...fulfillmentMix.entries()].map(([key, value]) => ({
          key,
          ...value,
        })),
      },
      hourly: hourlySales.map((bucket) => ({
        ...bucket,
        orderAverageWaitSeconds: waitStats(
          completedOrderWaits.filter((row) => row.hour === bucket.hour),
        ).averageSeconds,
        itemAverageWaitSeconds: waitStats(
          completedItemWaits.filter((row) => row.hour === bucket.hour),
        ).averageSeconds,
      })),
      orderGrain: {
        summary: waitStats(completedOrderWaits),
        distribution: distribution(completedOrderWaits),
        trend: hourlyWait(completedOrderWaits),
        lateRows: topLateOrders,
        activeRows: activeOrderRisks
          .sort((a, b) => b.seconds - a.seconds)
          .slice(0, 12),
      },
      menuGrain: {
        summary: waitStats(completedItemWaits),
        distribution: distribution(completedItemWaits),
        trend: hourlyWait(completedItemWaits),
        menuRows,
        lateRows: topLateItems,
        activeRows: activeItemRisks
          .sort((a, b) => b.seconds - a.seconds)
          .slice(0, 12),
      },
      incidents: incidents.map((incident) => ({
        id: incident.id,
        orderId: incident.orderId,
        orderNo: incident.order.orderNo,
        messageJa: incident.messageJa,
        dismissedAt: incident.dismissedAt,
        createdAt: incident.createdAt,
      })),
      orders: orders
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((order) => {
          const soldItems = order.items.filter((item) => isSoldItem(item.status));
          const servedTimestamps = soldItems
            .map((item) => item.servedAt)
            .filter((servedAt): servedAt is Date => Boolean(servedAt));
          const finalServedAt =
            servedTimestamps.length > 0
              ? new Date(Math.max(...servedTimestamps.map((servedAt) => servedAt.getTime())))
              : null;
          const waitSeconds =
            order.confirmedAt && finalServedAt
              ? secondsBetween(order.confirmedAt, finalServedAt)
              : order.confirmedAt && isRevenueOrder(order.orderStatus)
                ? secondsBetween(order.confirmedAt, now)
                : null;

          return {
            id: order.id,
            orderNo: order.orderNo,
            createdAt: order.createdAt,
            confirmedAt: order.confirmedAt,
            completedAt: finalServedAt,
            fulfillmentType: order.fulfillmentType,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus,
            orderStatus: order.orderStatus,
            totalPriceJpy: order.totalPriceJpy,
            itemCount: soldItems.length,
            waitSeconds,
            isActive: isRevenueOrder(order.orderStatus) && order.orderStatus !== "COMPLETED",
          };
        }),
    });
  } catch (error) {
    return fail(error);
  }
}
