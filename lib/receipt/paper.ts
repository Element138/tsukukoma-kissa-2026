import type { ReceiptPaperSize } from "@/lib/receipt/types";

const POINTS_PER_MM = 72 / 25.4;

export function mmToPoints(mm: number) {
  return mm * POINTS_PER_MM;
}

export const RECEIPT_PAPER = {
  // Epson specifies 79.5 mm roll paper with a 72 mm (576-dot) print area.
  large: {
    label: "印刷（大）",
    printer: "EPSON TM-P80II",
    paperWidthMm: 79.5,
    printableWidthMm: 72,
    horizontalMarginMm: 3.75,
    verticalMarginMm: 5,
    bodyFontPt: 8.6,
    itemFontPt: 9.2,
    titleFontPt: 14,
    orderNoFontPt: 24,
  },
  // The 58 mm ESC/POS class uses a 48 mm (384-dot at 203 dpi) print area.
  small: {
    label: "印刷（小）",
    printer: "ZJ-5890K / Zjiang",
    paperWidthMm: 58,
    printableWidthMm: 48,
    horizontalMarginMm: 5,
    verticalMarginMm: 4.5,
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
