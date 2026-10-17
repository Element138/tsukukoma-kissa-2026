# Counter order-age alerts

The shared thresholds are 10, 25, and 40 minutes from order creation (`lib/order-age.ts`). Counter and active order-book colors are green below 10 minutes, yellow at 10, red at 25, and purple at 40. Order-display long-wait announcements continue to use 25 and 40 minutes from the same constants.

On the counter, tap **音声通知を有効にする** after opening the page. Keep the page visible and the device's media volume audible. Where supported, the browser audio session requests `playback`, and a single user-activated media element plays all clips. This is media playback rather than a notification sound; iPhone Silent mode need not silence it. Browser/OS restrictions, media volume zero, interruptions, backgrounding, or screen locking can still prevent reliable playback. Test the intended physical iPhone/iPad before relying on alerts.

Only the orders returned by `/api/counter/targets` and currently displayed on the counter are eligible. Each alert plays the provided sound (10-16 at 10 minutes, 10-17 at 25, 10-18 at 40), then the existing cached order-number clip and a cached `X分経過。` clip, without continuation announcements. Complete clips are prefetched before the tone begins; the queue is serialized, with no intentional inter-order pause. Newly displayed overdue orders announce their highest elapsed threshold rather than replaying older thresholds. A subsequent threshold can still alert normally.

Completed announcements are saved per counter actor in this browser's local storage for three days, so a page reload normally does not repeat them. Interrupted or failed announcements are not marked delivered. Removing an order, hiding the page, stopping alerts, or receiving no fresh counter data for 30 seconds interrupts playback. Sound/read failures show an error and require re-enabling. No server-side order/payment state is changed by the alerts.

For order numbers 1–2000, the existing public `number-N.mp3` clips are reused. Higher numbers use the existing authenticated order-display TTS route; WAITER access was explicitly approved by the owner. The three elapsed-time clips are generated once with `scripts/generate-counter-age-audio.ts`, using the same `synthesizeJapaneseSpeechMp3` helper and settings as the order display (Japanese Chirp3-HD-Despina, MP3, speaking rate 1.14, pitch 0). No new voice settings or materials are required. Keep the API key server-only.

Run `node --env-file=<private-env-file> node_modules/tsx/dist/cli.mjs scripts/generate-counter-age-audio.ts` to create missing elapsed-time clips. Existing clips are preserved. A billing-enabled Google Cloud project with Cloud Text-to-Speech enabled is required for generation and uncached high order numbers.

Checks: `scripts/counter-age-alerts.test.ts` tests thresholds, eligibility, catch-up, ordering, and source selection. `scripts/counter-age-browser-check.ts` uses mocked orders and media playback to test the UI and serialized sequence; it does not establish physical-device audibility.

New menus created through the admin screen/API default allergen display to off, including after the new-menu form is reset. Existing menu settings are preserved.

## Bulk serving and call completion

Each counter card shows a green **全て提供** button at its bottom when at least two items are currently servable. It serves the items covered by shared ready stock, rather than marking uncooked items served. If a menu has insufficient ready stock, the confirmation lists each affected menu's waiting and servable quantities (including zero). Canceling leaves everything untouched. The server locks all relevant menus in stable order, checks the exact item/count snapshot, and rejects changed stock or order state so staff must refresh and confirm again. The operation is transactional and idempotent, and creates one batch undo entry. Undo restores the batch's stock and waiting items together; an intervening order change blocks it.

Serving the last waiting item clears the order's active call. Completed orders cannot be called again. Call history is preserved, and undoing service does not silently re-call the customer. The order display filters completed calls, removes queued announcements for orders no longer called, and aborts any active announcement/overlay when the next server refresh reports the call ended.
