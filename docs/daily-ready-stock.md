# Daily ready stock

Prepared stock expires at 00:00 Japan time. Every kitchen/counter stock read and every cooking/serving/manual-closure/undo write checks `MenuStock.stockResetAt` against the current JST day boundary. Expired rows are atomically zeroed and stamped before their counts are used. A closed browser, offline terminal, or missed cron cannot keep yesterday's food available: the first subsequent access enforces expiry. Repeated reads preserve today's new cooking. The implementation adds no scheduled invocation and does not reset orders, payments, historical serving times, daily sales, or cooking history.

Kitchen and counter pages request a refresh at JST midnight and on returning to visibility. They immediately discard yesterday's displayed stock before refreshing, even if the network request fails, and reject stock responses started on the previous day. With expired ready stock removed, existing kitchen demand calculation yields 0個調理待ち if no item awaits and X個調理待ち if X await. Previous-day surplus disappears. New cooking after midnight can create ordinary same-day surplus again. Outstanding orders remain outstanding and require new cooking.

Stock mutation paths retain their existing menu/order locks. Expiry for serving/manual closure is checked after acquiring those locks. Previous-day undo operations are rejected, including a second day check after lock waits, so they cannot resurrect discarded stock or subtract from a new day's cooking.

Migration `20261017100000_daily_ready_stock` adds a timestamp with the current time as default. It was applied without changing current ready counts, which remain available until the next JST midnight. The API then enforces day expiry regardless of whether any terminal was running at midnight.

Counter speech now uses cached **注文から25／40分経過。** clips under new `elapsed-from-order-*.mp3` URLs. Order-number clips are reused. `scripts/counter-258-playback-check.ts` verifies the real media player completes both 25/40-minute tone → number 258 → elapsed speech sequences, while 10 minutes remains silent in the counter view using an isolated mocked order. It does not alter the real order. `scripts/counter-audio-samples.ts 258` creates playable samples from the exact source sequence.

Manual closure keeps its audited `MANUAL_CLOSURE` action but now appends **手動完了** to 備考. Its confirmation is shortened to the order number, remaining items being marked served, and manual completion being recorded. Existing historical notes are preserved.

Checks: `scripts/daily-ready-stock.test.ts` covers the exact JST boundary, repeat-safe expiry, preservation of fresh stock, scoped updates, previous-day undo rejection, and the real kitchen queue handler's zero/remaining-demand response. Existing stock, manual closure and counter alert tests continue to cover their respective flows. Browser checks validate the shorter confirmation and the new speech through real audio playback.
