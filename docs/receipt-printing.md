# Receipt printing

The POS opens the shared receipt-size dialog after payment completes. The
order-book's レシート再印刷 action opens the same dialog. Receipts are available
for PAID or intentionally SKIPPED payments; failed and canceled orders are
excluded. Fulfillment does not have to be COMPLETED.

On iPad, the large option hands the PDF to TM Print Assistant and the small
option uses SII URL Print Agent for MP-B20. On laptops, both open PDFs in a new
tab. Printer handoff remains separate from PDF generation.

## MP-B20 small-receipt setup

The adopted MP-B20 uses 58 mm paper and a 48 mm print area. Pair it with the
iPad over Bluetooth, install SII URL Print Agent, and select MP-B20 in that app.
Then open a paid receipt in POS, wait for preparation and tap 印刷（小） to open
the SII app. Tear off the paper manually after printing. Laptop PDF previews
and the existing small layout are preserved; the Chinese-printer/BR RawPrinter
route is no longer the designated small-printer flow.

The authenticated PDF is sent as URL-encoded Base64 using
`siiprintagent://1.0/print`, with 58 mm paper, fit-to-width, a 60-second timeout,
native error dialogs/reselection and manual tear-bar feed. Connections are
released after printing so another terminal can connect. PDFs over 500 KiB or
handoffs over 750 KiB show an error and retain the PDF fallback. Fit-to-width
also makes SII reject receipts exceeding its 500 mm length limit instead of
silently truncating. Hardware output still needs device testing.

Protocol: https://www.sii-ps.com/common/URLPRNAgent_Android_iOS_JA_01.pdf
Tests: `node --test scripts/sii-handoff.test.cjs scripts/epson-handoff.test.cjs`.

## Layout and assets

- Large: 79.5 mm page, 68 mm content width, 5.75 mm horizontal margins.
- Small: 58 mm page, 44 mm content width, 7 mm horizontal margins.
- Shared renderer: `lib/receipt/render-pdf.ts`; page settings: `lib/receipt/paper.ts`.
- Japanese text uses embedded Noto Sans JP. Only the order-number digits use
  embedded Lato Bold from Google Fonts. Font licenses are in `public/fonts`.
- Order-number padding is 3.5 mm above and below the visible glyph bounds.
- 店内 has a black outline on white; 持ち帰り uses white text on black.
- Footer: 受け取り時にお見せください. The supplied logo is bundled locally.
- PDFKit skips its unused default Helvetica initialization to avoid a missing
  standard-font module in the Vercel runtime. Font and logo files are explicitly
  included in the receipt function's deployment trace.

## Validation and release

User QA approved the receipt layout before the production release on
2026-10-12. Type checking and visual PDF inspection covered both paper sizes,
long Japanese item names, takeout, and dine-in. Generate samples with
`npx tsx scripts/preview-receipts.ts` or add `--dine-in`.

No database/schema changes or test-data seeding are required. The existing
`vercel.json` build command generates Prisma Client and builds Next.js without
running the database-reset/seed script. The production deployment URL and
revision are recorded on the receipt feature PR.

## Epson iPad handoff

On iPad/iPhone (including iPadOS desktop-mode Safari), the shared dialog
prepares the authenticated large PDF in memory. The large button becomes a
direct user-activated `tmprintassistant://tmprintassistant.epson.com/print`
link with `ver=1`, `data-type=pdf` and URL-encoded Base64 `data`. This avoids
relying on a Share extension and avoids exposing an unauthenticated receipt
endpoint or sending POS cookies to the native app. No automatic print retry is
performed, and launching the app is not reported as a successful print.

The request asks the app to fit the PDF to the TM-P80II's 72 mm print area,
display errors, and permit printer reselection after connection failures.
It explicitly sends `cut=feed` to feed the finished receipt to the tear/cut
position, instead of relying on trailing blank PDF pixels. The manual-cutter
TM-P80II feeds without actuating a cutter; an auto-cutter model may also cut.
This is not a programmable 5 mm extra margin. No dummy dot or PDF layout change
is added, and the physical feed distance still needs checking on the printer.
Do not substitute `feed-position=cutting`: that option is for black-mark paper.
After success it returns to the calling POS/order-book URL. A PDF-preview link
remains available. Laptops continue opening PDFs; iPad's small option uses
SII URL Print Agent as described above.

First use: open TM Print Assistant, select the TM-P80II, and run its communication
test. Use Bluetooth Classic or Wi-Fi: Epson excludes PDF printing over BLE.
In POS, open the receipt dialog, wait for PDF preparation, tap 印刷（大） and
accept the iOS Open prompt. Follow the app's printer-selection/error prompts.
If no app opens, verify its installation and retry the button deliberately.

Payloads over the conservative 150 KiB PDF / 200 KiB encoded-URL limits display
an error and retain PDF preview instead of silently truncating a receipt.
Run `node --test scripts/epson-handoff.test.cjs` for protocol/encoding tests.
The manual download at Epson Japan was unavailable from the development host;
the protocol follows Epson's TM Print Assistant URL-scheme interface. Actual
iPad launch and physical printing still require testing on the operator device.

Sources:
- https://www.epson.jp/products/receiptprinter/develop/print.htm
- https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_cv.html
- https://www.epson.jp/support/portal/used/t203b084b.htm
- https://download3.ebz.epson.net/dsc/f/03/00/17/22/14/19fdc3488a02b7312bfd575e6046b6fba267be4e/ov_TM_Print_Assistant_iOS_v1.17.0.pdf
