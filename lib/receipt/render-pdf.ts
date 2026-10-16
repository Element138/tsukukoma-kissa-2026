import { renderAdobeReceiptPdf } from "@/lib/receipt/render-adobe-pdf";
import { renderReceiptPdfFallback } from "@/lib/receipt/render-pdf-fallback";
import type { ReceiptRenderParams } from "@/lib/receipt/receipt-html";
import { createHash } from "node:crypto";

type ReceiptRenderer = (params: ReceiptRenderParams) => Promise<Uint8Array>;

export function createReceiptPdfRenderer(renderAdobe: ReceiptRenderer, renderFallback: ReceiptRenderer = renderReceiptPdfFallback) {
  // Cache finished, immutable PDFs, never Adobe's font files or failed renders.
  // Reopening an unchanged receipt should not depend on another CDN request.
  const cache = new Map<string, { pdf: Uint8Array; expiresAt: number }>();
  const inFlight = new Map<string, Promise<Uint8Array>>();
  return async (params: ReceiptRenderParams): Promise<Uint8Array> => {
    const key = createHash("sha256").update(JSON.stringify([params.size, params.data, params.renderOrigin])).digest("hex");
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.pdf;
    cache.delete(key);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const result = (async () => {
      try {
        const pdf = await renderAdobe(params);
        cache.set(key, { pdf, expiresAt: Date.now() + 15 * 60 * 1000 });
        if (cache.size > 32) cache.delete(cache.keys().next().value!);
        return pdf;
      } catch (error) {
        console.warn("Adobe receipt rendering failed; using Noto Sans JP", error instanceof Error ? error.message : "Unknown rendering error");
        return renderFallback(params);
      }
    })();
    inFlight.set(key, result);
    try { return await result; }
    finally { inFlight.delete(key); }
  };
}

const renderDefaultReceipt = createReceiptPdfRenderer(renderAdobeReceiptPdf);

// Keep the proven, local-font generator independent of browser/CDN availability.
// Never return a blank receipt just because Adobe Fonts or Chromium failed.
export async function renderReceiptPdf(
  params: ReceiptRenderParams,
  renderAdobe?: ReceiptRenderer,
) {
  return renderAdobe ? createReceiptPdfRenderer(renderAdobe)(params) : renderDefaultReceipt(params);
}
