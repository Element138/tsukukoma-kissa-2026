# Cashier photos

POS requires a working front camera. Revocation, a stopped/muted/frozen stream, or leaving the page locks POS until a live stream is available again. Cash and skipped-payment checkout capture before order confirmation. Square captures before app launch; webhook reconciliation never requires access to the browser camera.

Square uses a capture/preparation button followed by the existing native form/303 app handoff. The second explicit tap preserves Safari's user-initiated external-app navigation after the asynchronous photo upload.

Images are JPEG, at most 100,000 bytes, in a private Supabase Storage bucket. There is no retention deadline or scheduled deletion. At 2,000 images/month the maximum growth is 200 MB/month. A full free allocation stops new checkout until an administrator permits storage failures for the current JST date. This permission expires at the next JST midnight, is checked on the server, and is committed in the same database transaction as `PHOTO_STORAGE_FAILURE_DISMISSED`. Each affected checkout also records `CASHIER_PHOTO_STORAGE_SKIPPED`. Camera failures cannot use this permission.

The photo checkout key and actor must match the order. Uploads never upsert, already stored/bound images cannot be replaced, and retrying an uncertain upload verifies its original hash. Pending client frames are kept in IndexedDB only to retry the same checkout and removed after checkout. Order book viewers request a 60-second signed URL on demand. API responses are not cached. Existing orders have no image and require no backfill.

## Setup

1. Apply Prisma migrations to the intended application database. Preview builds deliberately do not migrate a shared production database. Use a separate database/schema for Preview, provisioned explicitly.
2. Ensure the existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_JWT_SECRET` point to the intended Supabase project. Storage requests use 60-second server-only JWTs scoped to one bucket, object, and operation; ordinary realtime tokens have no access.
3. Optionally set `CASHIER_PHOTO_BUCKET` (default `cashier-photos`). Use a separate bucket for Preview.
4. With environment variables loaded, run `npx tsx scripts/setup-cashier-photo-storage.ts`. It creates/configures only the selected private bucket and its policies, without deleting images. Users cannot update or delete objects even if other buckets have permissive policies. Cloud administrators can still intervene.
5. Confirm the Supabase organization remains on Free. Free stops/restricts service rather than charging for overage. Without expiry, storage will eventually fill; the daily override permits operation without an image and does not create additional storage.

Application tables hold metadata only. Deleting orders through the existing administrator purge detaches the retained images; it does not delete stored objects. No new image deletion interface is introduced.

## Audit capacity snapshot (2026-10-28 JST)

Read-only measurement: 2,502 audit rows, 1,114,093 bytes of row data, 2,359,296 bytes including indexes/allocated pages. Entire database: 18,295,955 bytes. If an additional five times historical activity produces similarly sized records, audit storage is approximately 14.2 MB total (six times today's allocation); proportional whole-database growth would be approximately 109.8 MB. Both fit the 500 MB Free database allocation, but these are estimates, not a forecast of bandwidth, realtime messages, external platform logs, or unusually large audit payloads. Photo bytes are not stored in audit JSON.
