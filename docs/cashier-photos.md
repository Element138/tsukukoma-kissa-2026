# Cashier photos

After successful POS login, camera capture is best-effort. An unavailable, denied, stopped, muted, or frozen camera never locks the updated POS. Connection attempts time out after five seconds, and checkout photo preparation (frame/cache/encoding/upload) has a three-second total deadline. Failed or timed-out preparation releases checkout and aborts further client photo work. Cash and skipped-payment checkout attempt a photo before submission; Square attempts one before its explicit app-launch button. Webhook reconciliation never requires access to the browser camera.

Square uses a preparation button followed by the existing native form/303 app handoff. Preparation finishes even without a photo. The second explicit tap preserves Safari's user-initiated external-app navigation after asynchronous preparation.

Images remain JPEG, at most 100,000 bytes, in a private Supabase Storage bucket. There is no retention deadline or scheduled deletion. Authenticated updated POS submissions and Square-launch requests explicitly request `cashierPhotoBestEffort`. Those requests can continue without capture or storage availability and record `CASHIER_PHOTO_SKIPPED` when no valid stored image can be attached. A stored image is attached only to its matching checkout/actor and cannot be reused for another order. Login, actor-role checks, order ownership, menu caps, and Square payment verification still apply. Requests without the explicit option retain the legacy strict photo policy and administrator daily storage override; older POS tabs must reload to use the new behavior.

The photo checkout key and actor must match the order. Uploads never upsert, already stored/bound images cannot be replaced, and retrying an uncertain upload verifies its original hash. Pending client frames are kept in IndexedDB only to retry the same checkout and removed after checkout. Order book viewers request a 60-second signed URL on demand. API responses are not cached. Existing orders have no image and require no backfill.

## Setup

1. Apply Prisma migrations to the intended application database. Preview builds deliberately do not migrate a shared production database. Use a separate database/schema for Preview, provisioned explicitly.
2. Ensure the existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_JWT_SECRET` point to the intended Supabase project. Storage requests use 60-second server-only JWTs scoped to one bucket, object, and operation; ordinary realtime tokens have no access.
3. Optionally set `CASHIER_PHOTO_BUCKET` (default `cashier-photos`). Use a separate bucket for Preview.
4. With environment variables loaded, run `npx tsx scripts/setup-cashier-photo-storage.ts`. It creates/configures only the selected private bucket and its policies, without deleting images. Users cannot update or delete objects even if other buckets have permissive policies. Cloud administrators can still intervene.
5. Confirm the Supabase organization remains on Free. Free stops/restricts service rather than charging for overage. Without expiry, storage will eventually fill; updated POS sessions continue without an image and do not require a daily override.

Application tables hold metadata only. Deleting orders through the existing administrator purge detaches the retained images; it does not delete stored objects. No new image deletion interface is introduced.

## Audit capacity snapshot (2026-10-28 JST)

Read-only measurement: 2,502 audit rows, 1,114,093 bytes of row data, 2,359,296 bytes including indexes/allocated pages. Entire database: 18,295,955 bytes. If an additional five times historical activity produces similarly sized records, audit storage is approximately 14.2 MB total (six times today's allocation); proportional whole-database growth would be approximately 109.8 MB. Both fit the 500 MB Free database allocation, but these are estimates, not a forecast of bandwidth, realtime messages, external platform logs, or unusually large audit payloads. Photo bytes are not stored in audit JSON.
