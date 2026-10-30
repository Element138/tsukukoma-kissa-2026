# Absent orders

The counter's 不在 action is available for orders with at least one currently
servable item. It atomically marks all unserved items `GHOSTED`, stores
`Order.ghostedAt`, clears the active call and appends an `ORDER_GHOSTED` audit.
Served items, payments, prices and daily order caps are unchanged. Repeated
requests are idempotent. Call and serving operations serialize with this action.

The normal counter and kitchen demand exclude absent items. 不在注文, to the
left of the counter heading, opens the separate list. That list retains single
and bulk service from shared ready stock, and undo. Calls are unavailable both
in the UI (including the order book) and the API. Absent orders remain visible
in this list when stock is reduced or expires; they do not request replacement
cooking. Undoing service restores `GHOSTED` for an absent order. Completing all
items removes the order from the active absent list.

The customer order display separates absent numbers from waiting and called
orders in a compact ご不在 panel below the waiting list. Long absent lists scroll
automatically. Counter age announcements also exclude absent orders.

This requires the additive `20261030120000_absent_orders` migration. Preview
builds do not apply migrations: the feature Preview uses the dedicated
`kissa_absent_orders_preview` schema with configuration copied from the existing
Preview, and RLS enabled on its tables. No production schema changes are needed
to review the Preview. Deployment to production requires the migration before
the new application starts. Once GHOSTED items exist, rolling back to older
application code that does not recognize that enum value is unsafe.

Validation:

- `npx tsx scripts/absent-orders-integration.test.ts` requires `.env.absent.local`
  pointing to the dedicated schema. It checks actual API authorization, partial
  readiness, idempotent/audited marking, counter and kitchen counts after stock
  loss, customer display and call filtering, single/bulk serving and undo. It
  removes only fixtures identified by its generated test IDs.
- `node scripts/absent-orders-browser-check.mjs` tests actual screen components
  using local fixture APIs, including tablet, landscape and portrait 4K layouts.
- Existing counter bulk-service, footer and order-display refresh tests remain
  applicable.
