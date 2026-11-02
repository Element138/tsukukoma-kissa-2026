# Kitchen discard and uncook

For a negative quantity, the left button discards prepared items; the right button
returns them to uncooked. Both subtract prepared stock and today's cooked count.
Discard also subtracts from the finite daily order cap; uncook preserves the cap.
Unlimited caps stay unlimited. A finite cap cannot go below zero.
Reducing both the cooked count and cap for a discard preserves the remaining
planned production; returning an item to uncooked increases the work still to do.

The stock, cooked count, cap delta, audit and undo record commit in one transaction
under the menu row lock. The browser sends a quantity and correction type, never
a calculated replacement cap. Repeating the same idempotency key does not repeat
the subtraction; changing its quantity or correction type is rejected.

Manual cap changes in both the kitchen and admin use the same menu row lock and
an expected-cap value captured with the editor's baseline. A concurrent discard
cannot be overwritten by a stale absolute edit:

- Set 100 to 80 first, then discard 3: the result is 77.
- Discard 3 first, then submit an edit based on 100: the edit returns
  `MENU_CAP_CHANGED`; 97 is preserved and the editor refreshes for review.

Undo adds back the discard's actual cap delta to the then-current finite cap,
instead of restoring a stale snapshot. Switching to unlimited is respected.
Existing orders and their serving state are unaffected by discard or uncook.

Run `scripts/kitchen-discard.test.ts` for transaction-ordering, replay, undo,
authorization, insufficient stock and cap-boundary checks. Run
`scripts/kitchen-discard-browser.test.cjs` against a local Next.js server to check
the split actions at phone/tablet widths and editor recovery after a stale cap.
