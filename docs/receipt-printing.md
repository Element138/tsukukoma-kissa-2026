# Receipt printing

The POS opens the shared receipt-size dialog after payment completes. The
order-book's レシート再印刷 action opens the same dialog. Receipts are available
for PAID or intentionally SKIPPED payments; failed and canceled orders are
excluded. Fulfillment does not have to be COMPLETED.

Both options open PDFs in a new tab. Native iPad printer handoffs are not part
of this release and should remain separate from PDF generation.

## Layout and assets

- Large: 79.5 mm page, 72 mm content width, 3.75 mm horizontal margins.
- Small: 58 mm page, 48 mm content width, 5 mm horizontal margins.
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

Physical thermal printing and native iPad handoff still require device testing.
