# Square cashless payments

## Operating policy (2026-10-16)

The owner explicitly requires **NO offline payments**. Use iPhone or iPad in Safari and the Square POS app with the Square Reader (2nd generation). Cards and enabled Japanese electronic money use the CREDIT_CARD tender; cash, OTHER and QR tenders are not requested.

KISSa saves the order and one payment attempt before Square opens. A completed online payment must be verified against Square's server before the kitchen receives the order. Missing results, unavailable networks, API errors, mismatched amounts, missing server IDs and offline payments remain on hold. Time passing never proves a payment failed. No automatic re-charge, refund, or conversion to cash is performed.

Square's mobile-web request has no documented switch for disabling offline acceptance. Disable offline payments in **Square POS > More > Settings > Checkout > Offline payments**, including acceptance during Square outages. KISSa rejects payment records identified by Square as offline; it cannot override the Square app's settings or cancel a locally staged payment.

## Production configuration

Set the following in Vercel **Production only**, with secrets entered privately:

| Variable | Value |
| --- | --- |
| SQUARE_ENABLED | true, after the remaining setup and acceptance checks |
| SQUARE_APP_ID | sq0idp-7wrpFps3WCr8lohuEVlqmg |
| SQUARE_LOCATION_ID | LAFE6XWMNVF9E |
| SQUARE_CALLBACK_URL | https://tsukukoma-kissa-2026.vercel.app/api/square/callback |
| SQUARE_ACCESS_TOKEN | Production access token; server-only; never NEXT_PUBLIC_* |
| SQUARE_WEBHOOK_URL | https://tsukukoma-kissa-2026.vercel.app/api/square/webhook |
| SQUARE_WEBHOOK_SIGNING_KEY | Signature key for the subscription below |

In Square Developer Console:

1. Use the Production application. Point of Sale API > Web must contain the exact callback URL above (already registered by the owner).
2. Create a Production webhook subscription using the exact webhook URL above, API version 2026-09-16, and events **payment.created** and **payment.updated**. Save its signature key privately in Vercel.
3. The token must be able to read orders and payments (ORDERS_READ / PAYMENTS_READ if using scoped OAuth credentials). A personal production token belongs to the correct seller account.
4. Sign the Square POS app in to 喫茶班, location LAFE6XWMNVF9E. Pair the Reader and ensure card processing is active. Apply for and enable electronic money separately for this location; a fresh location alone does not establish Suica acceptance.
5. Disable offline payments. Check that Square has no automatic fees or tipping settings that change the KISSa amount. The request clears default fees; any resulting amount/tip mismatch still holds the order for review.

Square POS API does not support Sandbox. The supplied Sandbox application and Default Test Account location are deliberately not used for physical app-switch payments. Preview/development Vercel deployments cannot launch production payments, even if a production token was accidentally copied into those environments. A local build does not require Square credentials.

## Checkout and recovery

1. Submit the order in KISSa. A persistent, actor-scoped browser request record is written before sending, and the server uses its idempotency key.
2. Tap **Squareで決済を開始**. This separate explicit action makes app launching visible and gives Safari a user interaction. The server issues the launch once, atomically, and does not resend its link after an uncertain response.
3. Complete the card/e-money payment in Square and return to KISSa. The random callback state identifies the saved attempt; a callback alone cannot mark the order paid. KISSa retrieves the Square order and payment, checks completion, online status, location, JPY, exact amount, no tip/refund, time and the KISSa order marker.
4. Callback and signed webhook may arrive in any order. Row locks, a verification lease, and a unique Square transaction binding prevent duplicate confirmation. Completed verification is reused without further Square reads.
5. If the browser closes after order submission, reopening the same POS restores the pending order from the server. If the submission response was lost, the saved request key finds the existing order; otherwise **元の注文送信を安全に再試行** resends the identical saved request.
6. If the browser closes during/after payment, Square's signed server notification can reconcile a matching payment independently of the browser. This requires the webhook subscription to be configured and delivered. If Square does not preserve the KISSa marker in payment/order notes, automatic matching holds safely for manual reconciliation; validate note propagation on the physical device.

A launch request can be recorded without Square opening (browser interruption, missing app, lost response). KISSa cannot atomically control Safari and Square. In that case open Square manually and inspect unfinished payments and transaction history. Do not press a new charge request to see whether it works.

**Square payment_canceled** closes an unverified attempt as failed when no transaction is already bound. Other app errors remain unresolved. A later verified payment after closure raises an incident and does not silently send the order to the kitchen. No callback is accepted through the old debug simulator or generic manual confirmation/cancellation API.

If local browser storage is cleared, server-side pending Square attempts still survive. If the initial submission never reached the server and its saved request is also erased, no browser-only mechanism can recover that lost request. Browser closure itself does not cancel a payment or guarantee callback delivery.

## Administrator reconciliation

The administrator panel displays a reconciliation banner only while an undismissed payment incident exists. It refreshes through realtime events and every 60 seconds while visible. The reconciliation page at `/admin/square-payments` lists all unresolved Square orders with their POS, amount and last error, plus incidents for already-closed orders.

- **支払い状況を再確認**: supply a meaningful reconciliation note (10+ characters) and explicitly attest that the original terminal and history were checked. If no transaction is recorded, the server searches Square payments at the attempt's location since one minute before launch for the KISSa order marker. If automatic matching is inconclusive, expand **Square注文IDを指定する** and enter Square's **order ID / transaction_id**, not its payment_id or receipt number. The server still verifies amount, location, completed online status, currency, time and no refund/tip. Staff attestation can resolve a missing KISSa marker on a specified transaction; it cannot bypass payment verification.
- **未決済を確認して注文を終了**: first stop any unfinished checkout on the original Square device and inspect transaction history. The server checks Square before closing an attempt that was launched. If it finds a completed payment, it runs the same paid-order verification and kitchen confirmation as rechecking, and tells staff that payment was found. A pending payment, API outage, incomplete search, or ambiguous same-amount transaction blocks closure. An attempt never launched through KISSa can be closed without a Square request. Legacy orders missing their attempt record require individual investigation rather than this operation. Closing releases the order's menu-cap reservations; it does not cancel/refund anything at Square.
- Never close an uncertain payment just to unlock a terminal. Use the other POS while reconciling. For completed/duplicate/late payments, review incidents in the order book and handle any necessary refunds through Square following the payment method's rules.

If a Square ID was attached by a malformed/forged callback and fails verification, or several actual payments claim the same order marker, the system intentionally holds/raises an incident. Investigate the actual Square records before making any administrative data repair; there is no unrestricted 'mark paid' switch.

Square's payment list is eventually consistent, so absence alone cannot prove that no payment exists. Closure still requires staff to stop the original checkout and attest to checking the terminal/history. An empty search within 30 seconds of launch is rejected. A later verified payment raises an incident even if its transaction ID was already known when the order was closed. Searches are bounded to 500 payments and 10 additional same-amount order reads; reaching either limit blocks closure and asks for a specific Square order ID.

## Load limits

Normal confirmation reads two Square endpoints in one callback invocation. When a webhook must discover the KISSa marker from a Square order, it adds one order read. Callbacks and duplicate webhooks reuse the saved result. Automatic verification is capped at three attempts per payment, with at least 30 seconds between attempts; an administrator can request another attempt after the cooldown. No in-function sleeping or unbounded retry loop is used. Manual verification of a supplied ID validates it before binding, then reconciles; this can use four Square reads.

POS status polling runs every 12 seconds while a payment is pending and every 60 seconds otherwise, only while the document is visible, with overlapping polls suppressed. Existing realtime invalidations and focus/visibility changes also refresh status. Square notification delivery retries are provider-controlled; application verification remains bounded.

The planning volume is at most 1,500 cashless payments and two POS devices over three seven-hour days (42 device-hours). Polling alone is at most about 12,600 periodic requests if continuously pending, or about 2,520 if continuously idle, plus event-driven refreshes. These figures do not guarantee the whole project's Hobby quota: authentication, other terminals, receipts, builds, realtime and unrelated projects also consume resources. Measure production CPU/memory during acceptance testing.

## Database and deployment

Migration: `20261016000100_square_payment_attempt`. It adds the attempt table, unique order/state/transaction bindings and the missing-result incident enum. Back up the database before deployment. Inspect existing unresolved orders before switching versions; legacy attempts without the new state cannot be automatically trusted and must be reconciled by the administrator.

Migration `20261016000200_release_failed_order_caps` adds per-order menu-cap reservations and reconstructs daily order counts, excluding failed/canceled orders and respecting recorded manual count resets. Existing cooked counts and stock stay intact. Failed/canceled pending orders subsequently release their original day's reservations exactly once, including across midnight; uncertain payments continue reserving capacity. A manual daily count reset retires preceding reservations so a later failure cannot subtract from newer orders. Stop order entry and manual count resets during migration and deployment cutover so the old app cannot write orders without reservation records. The migration locks the source tables during reconstruction and has not been applied by local verification.

Production's Vercel build now runs `npm run vercel-build`: generate Prisma client, `prisma migrate deploy`, required postdeploy guards, then Next build. Any migration/guard failure stops deployment. There is no destructive reset fallback and no automatic reseeding. Preview/development builds do not migrate the database; use isolated preview data.

If the database was previously managed by `db push`, migration history may not match its schema. Inspect and baseline the history explicitly after backup. Do not reset data or mark unverified migrations as applied to bypass an error. Existing accounts/settings must not be reseeded over event operations.

## Acceptance checks before taking customer payments

Automated checks:

```
npx tsx --test scripts/square-payment.test.ts scripts/square-webhook.test.ts scripts/square-reconciliation.test.ts scripts/square-unpaid.test.ts scripts/menu-cap-release.test.ts scripts/shared-stock.test.ts
npx tsc --noEmit --incremental false
npm run build
```

### Testing without charging a card

Square Sandbox tests supported server APIs (including Orders, Payments with test tokens, and webhook notifications). It does not run the Square POS app, Reader hardware, or the Point of Sale app-switch protocol. The supplied automated tests use simulated responses; they are not live Sandbox integration tests.

Square's official in-person integration guidance recommends starting with a production **CASH tender** rehearsal, without exchanging actual money. This can test launch, amount transfer, successful return and cancellation, but cannot validate Reader card processing or KISSa's CARD-only server verification. A cash rehearsal still creates Square cash transaction records. KISSa's production cashless checkout deliberately excludes CASH, so use a separate diagnostic harness for that rehearsal; such a harness is not included in the current implementation. Do not enable CASH in normal cashless checkout or weaken its verification for testing.

Launching the normal card-only request and canceling in Square before presenting a card is another no-charge check of launch and cancellation. It does not establish that the successful payment path works.

### Final hardware acceptance

Use a controlled real-device test, on both iPhone and iPad if both will be used. POS API Sandbox does not simulate the Reader. Square Japan publishes a **1-yen test payment followed by a refund** procedure for credit cards/iD/QUICPay (and supported QR methods). This is a real payment, not Sandbox. Its business-restriction guidance generally prohibits self-payments but describes a limited small-value Reader-testing exception. Confirm the proposed card/account arrangement with Square Support if that exception's wording does not clearly cover it; do not run repeated arbitrary self-payments as a test suite.

**Do not use Suica or other transport IC cards for refundable test payments.** Square Japan explicitly advises against transport-IC testing because those payments cannot be refunded through Square. Use the electronic-money connection-speed check without making a payment, then verify transport-IC acceptance through an authorized genuine sale when appropriate. That speed check alone does not validate KISSa's successful payment path.

Sources:

- https://developer.squareup.com/docs/payment-card-support-by-country#testing-for-supported-countries
- https://squareup.com/jp/ja/townsquare/kihon-no-ki-5
- https://squareup.com/help/jp/ja/article/6386-why-can-t-square-support-all-businesses
- https://squareup.com/help/jp/ja/article/6712-jp-only-e-money-speed-test

- Verify the configured location, exact amount, automatic return, receipt, and exactly one kitchen confirmation. Use the documented refundable test methods above; do not make a dummy transport-IC payment.
- Verify a canceled Square payment, missing/not-signed-in Square app, lost network, disabled Reader and wrong location. No ambiguous result may cause a new automatic charge.
- Close Safari before submission returns, after order creation, during Square payment, and after payment before browser return. Reopen the POS, confirm recovery and idempotency, and verify webhook recovery without Safari open.
- Replay the same callback and Square notification; confirmation remains once. Check amount mismatch and invalid webhook signatures using automated tests rather than altering real receipts.
- Confirm Square preserves `[KISSa:ORDER_ID]` in the server-readable payment note or order line-item note/name. If absent, investigate Square's actual response and use administrator reconciliation; do not weaken automatic matching silently.
- Confirm offline acceptance is disabled in Square and an offline callback/payment never marks an order paid.
- Confirm administrator reconciliation and incident handling before enabling customer checkout.

This source implementation has not by itself registered the webhook, installed production secrets, migrated the live database, or completed the real-device acceptance checks.

## Official references

- https://developer.squareup.com/docs/pos-api/web-technical-reference
- https://developer.squareup.com/docs/pos-api/payments-integration
- https://developer.squareup.com/docs/webhooks/step3validate
- https://developer.squareup.com/docs/devtools/sandbox/overview
- https://squareup.com/help/jp/ja/article/7777-process-card-payments-with-offline-mode
- https://squareup.com/help/jp/ja/article/6711-jp-only-e-money-application
