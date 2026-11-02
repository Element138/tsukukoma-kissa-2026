import { prisma } from "@/lib/db";
import { predictPublicWaitTime, type PublicWaitTime, type WaitTimeAggregates } from "@/lib/domain/public-wait-time";

// Staff-triggered only; never called by the public reader.
export async function calculatePublicWaitTime(dayStart: string): Promise<PublicWaitTime | null> {
      const [row] = await prisma.$queryRaw<WaitTimeAggregates[]>`
        WITH eligible AS MATERIALIZED (
          SELECT o.id, o."createdAt", o."confirmedAt", o."fulfillmentType"::text AS kind,
            (NOT o."excludeFromWaitStats"
              AND NOT (o.events @> '[{"type":"MANUAL_CLOSURE"}]'::jsonb)
              AND NOT (o.events @> '[{"type":"ORDER_ITEMS_REFUNDED"}]'::jsonb)
              AND NOT (o.events @> '[{"type":"ORDER_GHOSTED"}]'::jsonb)) AS label_eligible
          FROM "Order" o
          WHERE o."createdAt" >= ${new Date(dayStart)}
            AND o."createdAt" < ${new Date(new Date(dayStart).getTime() + 86_400_000)}
            AND o."createdAt" <= statement_timestamp()
            AND o."confirmedAt" <= statement_timestamp()
            AND o."canceledAt" IS NULL
            AND o."paymentStatus"::text IN ('PAID', 'SKIPPED')
            AND o."orderStatus"::text NOT IN ('FAILED', 'CANCELED', 'GHOSTED')
            AND o."paymentSkipReasonType"::text IS DISTINCT FROM 'TEST'
            AND COALESCE(o."specialNote", '') NOT LIKE '%テスト%'
            AND NOT EXISTS (
              SELECT 1 FROM "OrderItem" test
              JOIN "Menu" m ON m.id = test."menuId"
              WHERE test."orderId" = o.id
                AND (test."itemNameSnapshot" LIKE '%テスト商品%' OR m.name LIKE '%テスト商品%')
            )
        ), item_stats AS (
          SELECT o.id, o.kind, o."createdAt", o."confirmedAt",
            COUNT(*) FILTER (WHERE i.status::text IN ('QUEUED', 'READY'))::int AS queued,
            (o.label_eligible AND BOOL_AND(i.status::text = 'SERVED'
              AND i."servedAt" IS NOT NULL AND i."servedAt" <= statement_timestamp())) AS complete,
            MAX(i."servedAt") AS finished,
            COUNT(*) FILTER (WHERE i.status::text = 'SERVED'
              AND i."servedAt" > statement_timestamp() - INTERVAL '20 minutes'
              AND i."servedAt" <= statement_timestamp())::int AS served20,
            COUNT(*) FILTER (WHERE i.status::text = 'SERVED'
              AND i."servedAt" > statement_timestamp() - INTERVAL '60 minutes'
              AND i."servedAt" <= statement_timestamp())::int AS served60
          FROM eligible o JOIN "OrderItem" i ON i."orderId" = o.id
          GROUP BY o.id, o.kind, o."createdAt", o."confirmedAt", o.label_eligible
        ), takeout_recent AS (
          SELECT id, finished FROM item_stats WHERE complete AND kind = 'TAKEOUT'
          ORDER BY finished DESC, id LIMIT 10
        ), margins AS (
          SELECT GREATEST(0, LEAST(10,
            EXTRACT(EPOCH FROM (r.finished - MIN(c."calledAt"))) / 60))::float8 AS lag
          FROM takeout_recent r JOIN "OrderCall" c ON c."orderId" = r.id
          WHERE c."calledAt" <= statement_timestamp()
          GROUP BY r.id, r.finished
        )
        SELECT
          COUNT(*) FILTER (WHERE complete AND kind = 'DINE_IN')::int AS "dineInCompleted",
          COUNT(*) FILTER (WHERE complete AND kind = 'TAKEOUT')::int AS "takeoutCompleted",
          COALESCE(SUM(queued), 0)::int AS "queueItems",
          COALESCE(PERCENTILE_CONT(0.9) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (statement_timestamp() - "confirmedAt")) / 60
          ) FILTER (WHERE queued > 0), 0)::float8 AS "queueAgeP90",
          COALESCE(SUM(served20), 0)::int AS "servedItems20",
          COALESCE(SUM(served60), 0)::int AS "servedItems60",
          AVG(EXTRACT(EPOCH FROM (finished - "createdAt")) / 60)
            FILTER (WHERE complete AND kind = 'TAKEOUT')::float8 AS "takeoutMean",
          (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lag) FROM margins)::float8 AS "dispatchMargin"
        FROM item_stats
      `;
  return row ? predictPublicWaitTime(row) : null;
}
