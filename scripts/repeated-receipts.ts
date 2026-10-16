import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { renderAdobeReceiptPdf } from "../lib/receipt/render-adobe-pdf";
import { closeReceiptBrowser } from "../lib/receipt/receipt-browser";
import type { ReceiptRenderParams } from "../lib/receipt/receipt-html";

async function main() {
  const [regularFontBytes, boldFontBytes, orderNumberFontBytes, logoBytes] = await Promise.all([
    readFile("public/fonts/NotoSansJP-Regular.otf"), readFile("public/fonts/NotoSansJP-Bold.otf"),
    readFile("public/fonts/Lato-Bold.ttf"), readFile("public/receipt/logo.png"),
  ]);
  await mkdir("output/pdf", { recursive: true });
  const render = async (index: number, size: "small" | "large", orderNo: number) => {
    const params: ReceiptRenderParams = {
      size, regularFontBytes, boldFontBytes, orderNumberFontBytes, logoBytes,
      data: { orderNo, transactionAt: new Date("2026-10-16T01:00:00Z"), fulfillmentType: "DINE_IN", tableNo: 3,
        paymentMethod: "CASH", paymentStatus: "PAID", totalPriceJpy: 300,
        items: [{ name: `再発行確認用コーヒー ${orderNo}`, quantity: 1, unitPriceJpy: 300 }],
      },
    };
    // Deliberately bypass fallback: every successful repeat must use Adobe.
    const pdf = Buffer.from(await renderAdobeReceiptPdf(params));
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    await writeFile(`output/pdf/repeated-${index}-${size}-${orderNo}.pdf`, pdf);
    console.log(`Adobe render ${index}: ${size}, #${orderNo}, ${pdf.length} bytes`);
  };
  for (let index = 0; index < 6; index++) await render(index, index % 2 ? "large" : "small", 202);
  await Promise.all([render(6, "small", 303), render(7, "large", 304)]);
}
void main().finally(closeReceiptBrowser);
