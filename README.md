# KISSa

Cafe operations system coordinating checkout, payment reconciliation, kitchen production, serving, customer displays, and sales records across staff terminals.

## Operation

| Interface | Responsibility |
| --- | --- |
| `/pos` | Dine-in and takeout orders, table and party details, cash or Square checkout, recorded payment-skip reasons, receipts. |
| `/kitchen` | Assigned menu demand, batch production, availability and daily limits, kitchen enablement and queued-item reassignment. |
| `/counter` | Orders with available prepared stock, manual customer calls, item-by-item serving, remaining demand and stock counts. Uses the `WAITER` role. |
| `/menu-display` | Rotating customer menu with prices, availability, lead times, allergens, and badges. |
| `/order-display` | Customer order status and queued Japanese voice announcements, including repeat calls and long-wait messages. |
| `/order-book` | Order history, payment and fulfillment traces, notes, repeat calls, receipt reprints, and CSV export. |
| `/sales` | Daily sales, menu quantities, fulfillment progress, and wait-time distributions by JST business date. |
| `/admin` | Terminal accounts, session revocation, menu categories, pricing, kitchen assignments, display settings, and data purge. |
| `/admin/square-payments` | Unresolved payment attempts, server verification, verified unpaid closure, and payment incidents. |
| `/audit` | Filtered operational audit records and CSV export. |

### Order and stock lifecycle

1. Order submission persists an idempotency key, menu-name and price snapshots, individual `OrderItem` records, and daily menu-cap reservations. Prices are integer JPY.
2. Payment confirmation assigns items to enabled kitchens responsible for each menu. Cash and explicitly skipped payments use the confirmation API; Square requires server verification.
3. Kitchens record production in batches against shared `MenuStock`, independently of individual orders. JST daily order counts and cooked counts are tracked separately; advance production is supported.
4. The counter lists confirmed orders that can be partially served from current stock. Listing or calling an order does not reserve stock. Each serving transaction consumes one stock unit and records the item, serving actor, and timestamp.
5. An order completes when every item is served. Customer calls are explicit, repeatable actions retained as separate records.

Daily limits are reserved at submission. Failed or canceled orders release their original day's reservations once; unresolved payments retain them. Manual count resets retire earlier reservations so subsequent failures cannot reduce newer counts.

### Payment control

Square checkout saves one payment attempt before launching the iOS Square POS app. Callback state identifies the attempt; signed webhooks can recover results independently of the browser. Confirmation checks Square's order and payment records for completion, online processing, location, JPY amount, timing, order identity, and absence of tips or refunds. Transaction bindings, row locks, and bounded verification retries prevent duplicate confirmation.

Uncertain payments remain pending and block another order on the originating POS. The watchdog raises a reconciliation incident when the result is overdue; elapsed time does not mark a payment failed or cancel it. Administrators can recheck a transaction or close a verified unpaid attempt with a recorded reconciliation note and terminal-history attestation. A verified payment arriving after failure raises an incident. KISSa does not automatically recharge or refund customers.

See [Square setup, reconciliation, and device acceptance checks](docs/square-payments.md). Offline acceptance must also be disabled in the Square app.

## Architecture

Next.js 15 App Router and React 19 provide the terminal interfaces and TypeScript API. PostgreSQL is the system of record, accessed through Prisma 6.

| Component | Behavior |
| --- | --- |
| Domain transactions | Coordinate order confirmation, cap reservations, stock consumption, serving, and undo. Menu and order row locks serialize conflicting changes. |
| Terminal identity | `Actor` represents a terminal or administrator. Kitchen IDs reference `Actor.id` with type `KITCHEN`; SQL triggers enforce that relationship. |
| Sessions | Server-stored, hashed session tokens in HTTP-only cookies; API role checks, actor heartbeats, inactivity expiry, and administrator revocation. |
| Undo | Retains the latest three production or serving actions per actor. Reversals check stock or the original served-item state and reject conflicts. |
| Audit | Records actor, action, entity, result, available before/after data, reasons, correlation IDs, and hash references to preceding records. |
| Realtime | Persistent `RealtimeEvent` records; SSE subscriptions for requested channels, plus Supabase Postgres Changes for `orders`, `counter`, `menus`, and `kitchen:{id}`. Channel authorization, Supabase RLS, reconnect resync, and periodic refresh govern delivery. |
| Receipts | Small and large PDFs rendered with Chromium and Adobe Fonts; PDFKit with bundled Noto Sans JP provides the fallback. iPad large-format printing hands the PDF to Epson TM Print Assistant. |
| Call audio | Bundled number recordings for orders 1 through 2000; authenticated Google TTS generation for higher numbers. |

Receipt generation and native printer handoff are separate operations. Launching the printer app does not confirm physical printing. See [receipt printing and device setup](docs/receipt-printing.md).

## Usage

```powershell
npm ci
Copy-Item .env.example .env
# Set database URLs and the integrations listed below.
npm run prisma:generate
npm run prisma:migrate
npx prisma db execute --file prisma/postdeploy.sql --schema prisma/schema.prisma
npm run prisma:seed
npm run dev
```

Open `/login`. Seeded credentials are `admin` / `admin1234`; `pos-main`, `kitchen-drink`, `kitchen-food`, `counter-1`, `menu-display-main`, and `order-display-main` use `1234`. Replace these secrets before operating with customer data. Run the seed only for initial setup; it upserts terminal accounts.

```powershell
npm run build
npm run start
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Runtime PostgreSQL connection. The example includes Supabase transaction-pooler parameters. |
| `DIRECT_URL` | Direct PostgreSQL connection for Prisma migrations and deployment guards. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser connection for operational realtime subscriptions. |
| `SUPABASE_JWT_SECRET` | Signs actor-scoped realtime tokens; migrations install the event-table RLS and publication. |
| `SQUARE_ENABLED` | Set to `true` to permit Square checkout; non-production Vercel environments are rejected. |
| `SQUARE_APP_ID`, `SQUARE_LOCATION_ID`, `SQUARE_CALLBACK_URL` | Production Square application, seller location, and exact return URL. |
| `SQUARE_ACCESS_TOKEN` | Server-side Square order and payment verification. |
| `SQUARE_WEBHOOK_URL`, `SQUARE_WEBHOOK_SIGNING_KEY` | Exact notification URL and signature verification key. |
| `CRON_SECRET` | If set, the watchdog endpoint requires a matching `x-cron-secret` request header. |
| `BLOB_READ_WRITE_TOKEN` | Administrator uploads of menu cover images to Vercel Blob. |
| `GOOGLE_TTS_API_KEY` | Call-number synthesis beyond the bundled audio range; also used by audio-generation scripts. |
| `RECEIPT_CHROMIUM_EXECUTABLE` | Optional local Chromium executable for receipt rendering. Windows also detects installed Chrome or Edge. |

`SESSION_SECRET` and `RECEIPT_PRINTER_MODE` appear in `.env.example` but are not read by the current runtime.

## Deployment and verification

`npm run vercel-build` generates Prisma, deploys migrations, applies `prisma/postdeploy.sql`, then builds Next.js. Migration or guard failures stop the build. With `VERCEL_ENV=preview` or `development`, it only generates the client and builds. With `VERCEL_ENV` unset, it takes the migration path. Deployments do not reset or seed the database. Use isolated preview databases and back up operational data before schema changes.

`vercel.json` schedules `/api/cron/payment-watchdog` daily at 00:00 UTC (09:00 JST). The endpoint also prunes realtime events older than 24 hours. POS status requests trigger additional best-effort watchdog runs. When `CRON_SECRET` is configured, the scheduler must supply the header documented above.

| Endpoint | Check |
| --- | --- |
| `/api/health` | Application response. |
| `/api/health/db` | Database connectivity, actor counts, and likely missing seed data. |
| `/api/system/status` | Authenticated terminal connectivity and queued work on inactive kitchens. |

```powershell
npx tsc --noEmit --incremental false
npx tsx --test scripts/*.test.ts
node --test scripts/*.test.cjs
npm run build
```

The suites cover payment validation and recovery, cap release, shared stock and undo, menu ordering, counter summaries, receipt rendering, Epson handoff, and static audio routing. Automated payment tests use simulated responses. Square Reader payments and physical receipt printing require device acceptance checks.

## File structure

```text
app/          Terminal pages and API route handlers
components/  Shared terminal UI, sessions, realtime, and printing
lib/domain/  Order, payment, kitchen, stock, serving, and audit rules
lib/server/  Authentication, realtime delivery, queries, and tracing
lib/receipt/ PDF renderers and Epson handoff
prisma/      Data model, migrations, SQL guards, and initial seed
public/      Call audio, fonts, and display/receipt assets
scripts/     Tests, receipt previews, audio generation, and build runner
docs/        Payment and printer operating guides
```
