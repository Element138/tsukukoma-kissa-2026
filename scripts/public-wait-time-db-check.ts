// Read-only PostgreSQL verification. Fixtures are CTEs, never persisted tables.
// node --env-file=.env --import tsx scripts/public-wait-time-db-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { resolveRuntimeDatabaseUrl } from "../lib/runtime-database-url";
import { tokyoDayRangeUtc } from "../lib/time";
import { predictPublicWaitTime, type WaitTimeAggregates } from "../lib/domain/public-wait-time";

const db = new PrismaClient({ datasources: { db: { url: resolveRuntimeDatabaseUrl(process.env.DATABASE_URL) } } });
const source = readFileSync(new URL("../lib/server/public-wait-time-calculation.ts", import.meta.url), "utf8");
const template = source.match(/await prisma\.\$queryRaw<WaitTimeAggregates\[\]>`([\s\S]*?)`;/)?.[1];
assert.ok(template, "Live SQL must be found; do not test a duplicate query");
const query = template
  .replace('${new Date(dayStart)}', '$1')
  .replace('${new Date(new Date(dayStart).getTime() + 86_400_000)}', '$2');
assert.ok(!query.includes('${'));

const fixtureCtes = `WITH seed AS (
  SELECT 'dine_' || n AS id, 'DINE_IN' AS kind FROM generate_series(1,10) n
  UNION ALL SELECT 'takeout_' || n, 'TAKEOUT' FROM generate_series(1,10) n
  UNION ALL SELECT id, 'TAKEOUT' FROM unnest(ARRAY[
    'test_complete','manual','refund','excluded','future','missing',
    'test_queue','queue','test_canceled_item','test_renamed_menu','test_skip','test_note'
  ]) id
), fixture_orders AS (
  SELECT id, statement_timestamp()-INTERVAL '40 minutes' AS "createdAt",
    statement_timestamp()-INTERVAL '39 minutes' AS "confirmedAt",
    kind AS "fulfillmentType", NULL::timestamp AS "canceledAt",
    'PAID' AS "paymentStatus", 'PREPARING' AS "orderStatus",
    id = 'excluded' AS "excludeFromWaitStats",
    CASE WHEN id='test_skip' THEN 'TEST' END AS "paymentSkipReasonType",
    CASE WHEN id='test_note' THEN 'テスト注文' ELSE '' END AS "specialNote",
    CASE WHEN id='manual' THEN '[{"type":"MANUAL_CLOSURE"}]'
         WHEN id='refund' THEN '[{"type":"ORDER_ITEMS_REFUNDED"}]'
         ELSE '[]' END::jsonb AS events
  FROM seed
), fixture_items AS (
  SELECT id AS "orderId", CASE WHEN id='test_renamed_menu' THEN 'test-menu' ELSE 'menu' END AS "menuId",
    CASE WHEN id IN ('test_complete','test_queue') THEN '大きなテスト商品セット' ELSE 'コーヒー' END AS "itemNameSnapshot",
    CASE WHEN id IN ('queue','test_queue') THEN 'QUEUED' ELSE 'SERVED' END AS status,
    CASE WHEN id='missing' THEN NULL
         WHEN id='future' THEN statement_timestamp()+INTERVAL '1 minute'
         ELSE statement_timestamp()-INTERVAL '29 minutes' END AS "servedAt"
  FROM seed
  UNION ALL SELECT 'test_canceled_item', 'menu', 'テスト商品', 'CANCELED', NULL
), fixture_menus AS (
  SELECT 'menu' AS id, 'コーヒー' AS name
  UNION ALL SELECT 'test-menu', 'テスト商品に変更'
), fixture_calls AS (
  SELECT id AS "orderId", statement_timestamp()-INTERVAL '32 minutes' AS "calledAt" FROM seed
), eligible AS`;

async function main() {
  const migration = readFileSync(new URL("../prisma/migrations/20261101000000_public_wait_time_snapshot/migration.sql", import.meta.url), "utf8")
    .replace('CREATE TABLE "PublicWaitTimeSnapshot"', 'CREATE TEMP TABLE "PublicWaitTimeSnapshot"')
    .replace(');', ') ON COMMIT DROP;');
  const publisher = readFileSync(new URL("../lib/server/public-wait-time-refresh.ts", import.meta.url), "utf8");
  const claim = publisher.match(/await prisma\.\$queryRaw<\{ id: number \}\[]>`([\s\S]*?)`;/)?.[1].replace('${token}', '$1');
  assert.ok(claim);
  await db.$transaction(async tx => {
    // Prisma prepared execution accepts a single statement at a time.
    for (const statement of migration.replace(/--[^\n]*/g, '').split(';').filter(part => /CREATE TEMP TABLE|ALTER TABLE/.test(part))) {
      await tx.$executeRawUnsafe(statement);
    }
    const attempts = await Promise.all(Array.from({ length: 40 }, (_, i) => tx.$queryRawUnsafe<unknown[]>(claim, `worker-${i}`)));
    assert.equal(attempts.filter(rows => rows.length).length, 1, "Exactly one lease winner");
    await tx.$executeRawUnsafe('UPDATE "PublicWaitTimeSnapshot" SET "leaseUntil" = NULL, "computedAt" = statement_timestamp()');
    assert.equal((await tx.$queryRawUnsafe<unknown[]>(claim, 'too-soon')).length, 0, "Fresh snapshot suppresses refresh");
    await tx.$executeRawUnsafe('UPDATE "PublicWaitTimeSnapshot" SET "computedAt" = statement_timestamp() - INTERVAL \'61 seconds\'');
    assert.equal((await tx.$queryRawUnsafe<unknown[]>(claim, 'next-minute')).length, 1);
  }, { timeout: 30_000 });
  const fixtureQuery = query.replace(/"OrderItem"/g, "fixture_items")
    .replace(/"OrderCall"/g, "fixture_calls")
    .replace(/"Order"/g, "fixture_orders")
    .replace(/"Menu"/g, "fixture_menus")
    .replace("WITH eligible AS", fixtureCtes);
  const start = new Date(Date.now() - 12 * 3600_000);
  const [fixture] = await db.$queryRawUnsafe<WaitTimeAggregates[]>(fixtureQuery, start, new Date(+start + 86400_000));
  assert.equal(fixture.dineInCompleted, 10);
  assert.equal(fixture.takeoutCompleted, 10);
  assert.equal(fixture.queueItems, 1, "Test queue must not contribute backlog");
  assert.equal(fixture.takeoutMean, 11, "Tests / manual / refund / excluded / future / missing must not enter labels");
  assert.equal(fixture.dispatchMargin, 3);
  assert.equal(fixture.queueAgeP90, 39);
  assert.deepEqual(predictPublicWaitTime(fixture), { dineIn: 25, takeout: 15 });
  const { start: dayStart, end } = tokyoDayRangeUtc();
  const [live] = await db.$queryRawUnsafe<WaitTimeAggregates[]>(query, dayStart, end);
  console.log(JSON.stringify({ fixtureChecks: "passed", temporaryLeaseTableChecks: "passed (40 claims; one winner)", liveAggregates: live, liveEstimates: predictPublicWaitTime(live) }, null, 2));
}
main().finally(() => db.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
