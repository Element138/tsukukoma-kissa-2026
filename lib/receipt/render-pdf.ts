import { renderAdobeReceiptPdf } from "@/lib/receipt/render-adobe-pdf";
import { renderReceiptPdfFallback } from "@/lib/receipt/render-pdf-fallback";
import type { ReceiptRenderParams } from "@/lib/receipt/receipt-html";

// Keep the proven, local-font generator independent of browser/CDN availability.
// Never return a blank receipt just because Adobe Fonts or Chromium failed.
export async function renderReceiptPdf(
  params: ReceiptRenderParams,
  renderAdobe: (params: ReceiptRenderParams) => Promise<Uint8Array> = renderAdobeReceiptPdf,
) {
  try {
    return await renderAdobe(params);
  } catch (error) {
    console.warn("Adobe receipt rendering failed; using Noto Sans JP", error instanceof Error ? error.message : "Unknown rendering error");
    return renderReceiptPdfFallback(params);
  }
}
