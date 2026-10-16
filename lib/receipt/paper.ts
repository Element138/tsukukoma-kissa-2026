import type { ReceiptPaperSize } from "@/lib/receipt/types";

const POINTS_PER_MM = 72 / 25.4;

export function mmToPoints(mm: number) {
  return mm * POINTS_PER_MM;
}

export const RECEIPT_PAPER = {
  // Keep a further 2 mm per side inside the printer's 72 mm print area.
  large: {
    label: "印刷（大）",
    printer: "EPSON TM-P80II",
    paperWidthMm: 79.5,
    printableWidthMm: 68,
    horizontalMarginMm: 5.75,
    verticalMarginMm: 9,
    bodyFontPt: 8.6,
    itemFontPt: 9.2,
    titleFontPt: 14,
    orderNoFontPt: 24,
  },
  // Keep a further 2 mm per side inside the printer's 48 mm print area.
  small: {
    label: "印刷（小）",
    printer: "ZJ-5890K / Zjiang",
    paperWidthMm: 58,
    printableWidthMm: 44,
    horizontalMarginMm: 7,
    verticalMarginMm: 8.5,
    bodyFontPt: 7.4,
    itemFontPt: 8,
    titleFontPt: 12,
    orderNoFontPt: 20,
  },
} as const satisfies Record<ReceiptPaperSize, object>;

export function receiptPdfPath(orderId: string, size: ReceiptPaperSize) {
  const params = new URLSearchParams({ size });
  return `/api/orders/${encodeURIComponent(orderId)}/receipt?${params}`;
}
