import { existsSync } from "node:fs";
import { chromium as playwright } from "playwright-core";
import { AppError } from "@/lib/errors";
import { RECEIPT_PAPER } from "@/lib/receipt/paper";
import { receiptHtml, type ReceiptRenderParams } from "@/lib/receipt/receipt-html";

async function launchReceiptBrowser() {
  if (process.platform === "linux") {
    const { default: chromium } = await import("@sparticuz/chromium");
    return playwright.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true, timeout: 10000 });
  }
  const executablePath = [
    process.env.RECEIPT_CHROMIUM_EXECUTABLE,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find(p => p && existsSync(p));
  if (!executablePath) throw new Error("Receipt Chromium is unavailable");
  return playwright.launch({ executablePath, headless: true, timeout: 10000 });
}

export async function renderAdobeReceiptPdf(params: ReceiptRenderParams) {
  const browser = await launchReceiptBrowser();
  // Includes font downloads, font readiness and PDF export, even if a CDN hangs.
  const deadline = setTimeout(() => { void browser.close().catch(() => {}); }, 20000);
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 1200 } });
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
  } finally {
    clearTimeout(deadline);
    await browser.close().catch(() => {});
  }
}
