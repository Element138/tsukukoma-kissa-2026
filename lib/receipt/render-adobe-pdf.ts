import { AppError } from "@/lib/errors";
import { RECEIPT_PAPER } from "@/lib/receipt/paper";
import { receiptHtml, type ReceiptRenderParams } from "@/lib/receipt/receipt-html";
import { withReceiptPage } from "@/lib/receipt/receipt-browser";

export async function renderAdobeReceiptPdf(params: ReceiptRenderParams) {
  const startedAt = Date.now();
  const render = () => withReceiptPage(async page => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    page.setDefaultTimeout(12000);
    await page.emulateMedia({ media: "print" });
    // Give the web kit the requesting website's origin, without sending receipt
    // content through an HTTP endpoint or making a request to that origin.
    const origin = new URL(params.renderOrigin ?? "https://tsukukoma-kissa-2026.vercel.app").origin;
    const renderUrl = `${origin}/__internal-receipt-render`;
    await page.route(renderUrl, route => route.fulfill({ contentType: "text/html; charset=utf-8", body: receiptHtml(params) }));
    await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (window as unknown as { receiptFonts: string }).receiptFonts !== "loading");
    const ready = await page.evaluate(async () => {
      await document.fonts.ready;
      const adobeReady = (window as unknown as { receiptFonts: string }).receiptFonts === "active";
      const hasAdobeFace = Array.from(document.fonts).some(face => face.family.replace(/["']/g, "") === "dnp-shuei-gothic-kin-std" && face.status === "loaded");
      const weights = [400, 500, 600];
      const text = document.querySelector("main")?.textContent ?? "";
      return adobeReady && hasAdobeFace && text.includes("ご注文番号") && weights.every(weight => document.fonts.check(`${weight} 12px "dnp-shuei-gothic-kin-std"`, text));
    });
    if (!ready) throw new AppError(503, "RECEIPT_FONT_UNAVAILABLE", "Adobe receipt font did not load");
    const height = await page.locator("main").evaluate(element => Math.ceil(element.getBoundingClientRect().height) + 1);
    if (!Number.isFinite(height) || height < 100) throw new Error("Receipt layout is empty");
    const pdf = await page.pdf({
      width: `${RECEIPT_PAPER[params.size].paperWidthMm}mm`, height: `${height}px`,
      printBackground: true, displayHeaderFooter: false,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    if (pdf.length < 1000 || pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("Receipt PDF is empty");
    return pdf;
  });
  try {
    return await render();
  } catch (error) {
    // A stale browser after a serverless freeze can fail immediately. Recreate
    // it once, within the existing request budget, before using Noto fallback.
    if (Date.now() - startedAt < 10000 && error instanceof Error && /target.*closed|browser.*closed|crash/i.test(error.message)) {
      return render();
    }
    throw error;
  }
}
