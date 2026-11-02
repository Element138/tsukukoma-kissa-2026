# Public waiting-time page

`/wait-time` is a minimal unauthenticated HTML route, outside the staff layout.
It displays イートイン / テイクアウト, each rounded to the nearest five-minute increment
with 分以上 (halfway values round upward; the existing five-minute minimum remains), and the exact caveat:
「お会計後の待ち時間の推定です。お並びになる時間は含んでおりません」.
No login controls, React scripts, fonts, images, order data or realtime subscriptions.
The document refreshes to the clean `/wait-time` URL every 120 seconds.

## Calculation is independent of visitors

Customer requests **never run the models or scan orders**. They only read the
singleton `PublicWaitTimeSnapshot` row. This read has a shared Next Data Cache
(60 seconds), a warm-process cache (60 seconds), and in-flight request coalescing.
HTML has a 60-second CDN cache and 30-second browser cache. Query strings and
reload headers cannot turn a snapshot read into a calculation.

Existing staff screens already request `/api/auth/me` every 10 seconds. After
successful authentication and construction of that response, this route schedules
a best-effort background refresh with Next `after()`. No new browser polling or
cron is added, and no timer/work is inserted into the realtime SSE loop.

Each warm process attempts at most once per minute. An atomic database lease on
the singleton row chooses one publisher across instances; losers do not aggregate.
A successful snapshot cannot be refreshed again for 60 seconds. A failed/abandoned
attempt holds a 90-second lease before retry. A refresh reads current-day order
aggregates, then updates only the snapshot. It holds no order-row locks and no
transaction open across the calculation. A token prevents an expired worker from
overwriting a newer publisher. If work exceeds the 90-second lease, a retry may
start before it finishes; this is not an absolute no-overlap guarantee.

The public reader withholds missing, invalid, future, previous-JST-day, or more
than five-minute-old snapshots. Freshness validation happens outside its data
cache. CDN/browser caching and the 120-second document refresh can delay the
visible transition to unavailable. Without active staff requests, snapshots stop
updating and eventually disappear. Errors never cause a customer-triggered retry
of the aggregate calculation.

This substantially isolates customer traffic from operational work, but does not
promise zero shared-database impact: uncached public reads still need one indexed
row, and the staff-driven calculation consumes a connection briefly. Multiple
cold instances can perform duplicate snapshot reads, though not customer-triggered
model scans. Verify production CDN hit rate and staff realtime latency after
deployment; local checks do not establish production realtime capacity.

## Models and eligibility

The selected portable research heads remain unchanged:

- Dine-in: `4 + .5 * queueItems / max(.5, servedItems20/20, servedItems60/60) + .5 * queueAgeP90`.
- Takeout: day-to-date completed takeout mean plus the median clipped (0–10 minute)
  first-call-to-final-serving interval for the latest ten eligible completions.
  Missing call history uses a two-minute precaution. The mean already includes
  handoff time; adding this margin is an empirically selected precaution, not a
  decomposition into service components.

The heads retain their 120-minute research cap. Each type starts only after
**10 eligible completions of that type on the current JST day**. This is an
operational minimum, not a statistically validated threshold. Otherwise it shows
「現在、待ち時間を推定できません」 without a number.

All orders containing any item whose snapshot or current menu name contains
「テスト商品」 are removed from every aggregate, including canceled test items.
Existing research exclusions for test notes / TEST skip reasons are retained.
Completed labels exclude manual closures, refunds, statistics exclusions,
incomplete/missing/future servings. Otherwise-active statistics-excluded orders
can still contribute backlog. Wait labels run from creation to final serving;
queue age runs from confirmation. Aggregation remains in PostgreSQL and returns
one small row; no full order export or audit replay runs during refresh.

Live heads use the current observed context; earlier research evaluated randomly
older contexts. Research results are exploratory and do not establish live
accuracy. 分以上 and upward rounding are not statistically guaranteed lower bounds.

## Deployment and validation

The new migration creates one independent singleton table with RLS enabled and
no public policies. It is not added to the realtime publication. Existing
production `vercel-build` applies migrations. **Deployed to production on Nov 1,
2026 (JST), with the snapshot migration applied successfully.** Deployment ID:
`dpl_HcPVtLXVVNSciW5G3Utz8VJ1Keij`; the main production alias is assigned.
The release reuses the prior live deployment source and changes only the wait-time
files, auth scheduling hook and additive schema/migration. Preview builds skip
production migrations; apply the migration to a separate preview DB
when testing publication there. Missing tables fail closed to unavailable.

Six focused tests passed (`npx tsx --test scripts/public-wait-time.test.ts`):
model parity/rounding, per-type warmup, minimal document, 40 customer cache misses
reading only one snapshot with no model dependency, stale/day-boundary validation,
and 40 simulated independent staff instances choosing one publisher without
awaiting calculation in the staff response.

`node --env-file=.env --import tsx scripts/public-wait-time-db-check.ts` verifies
actual PostgreSQL aggregate fixtures and the actual lease SQL with 40 attempts
against a **session-local temporary table**, fresh-snapshot suppression and
next-minute eligibility. No operational data or persistent tables are changed.
These SQL attempts share one transaction/connection; the cross-instance unit test
models independent publishers. Neither is a production realtime load test.

Focused TypeScript checks cover the new route, publisher, reader and auth hook.
The repository-wide check has existing enum errors and ignored tmp checkout errors.
Earlier local Chrome checks verified HTTP 200, a 1,618-byte unavailable document,
one document request, no scripts/fonts/data requests, mobile/desktop layouts and
40 simultaneous reload responses. Those browser checks preceded the snapshot
refactor; current focused tests verify the changed reader/publisher boundaries.
Evidence and screenshots are under ignored `output/public-wait-time/`.

Caching references: [Next Data Cache](https://nextjs.org/docs/app/api-reference/functions/unstable_cache)
and [Vercel cache headers](https://vercel.com/docs/caching/cache-control-headers).

## Nearest-five display revision

The current display rounds to the nearest multiple of five rather than always
upward. For example, 21 becomes 20 and 22.5 becomes 25. Both the publisher and
HTML renderer use this rule; the snapshot updates on the next normal staff-driven
refresh. The model equations, margin, eligibility, cache behavior and wording are
unchanged. Earlier CV scores and plots used the previous upward rounding rule.
