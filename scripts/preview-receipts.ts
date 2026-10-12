import { readFile, mkdir, writeFile } from "node:fs/promises";
import { renderReceiptPdf } from "../lib/receipt/render-pdf";

async function main() {
  const dineIn = process.argv.includes("--dine-in");
  const outputDir = dineIn ? "tmp/pdfs" : "output/pdf";
  const [orderNumberFontBytes, regularFontBytes, boldFontBytes, logoBytes] = await Promise.all([
    readFile("public/fonts/Lato-Bold.ttf"),
    readFile("public/fonts/NotoSansJP-Regular.otf"),
    readFile("public/fonts/NotoSansJP-Bold.otf"),
    readFile("public/receipt/logo.png"),
  ]);
  await mkdir(outputDir, { recursive: true });
  for (const size of ["small", "large"] as const) {
    const pdf = await renderReceiptPdf({
      size, regularFontBytes, boldFontBytes, logoBytes, orderNumberFontBytes,
      data: {
        orderNo: 202, transactionAt: new Date("2026-10-08T13:04:33Z"),
        fulfillmentType: dineIn ? "DINE_IN" : "TAKEOUT", tableNo: dineIn ? 3 : null,
        paymentMethod: "CASH", paymentStatus: "PAID", totalPriceJpy: 1500,
        items: [
          { name: "アイスコーヒー", unitPriceJpy: 300, quantity: 2 },
          { name: "自家製チョコレートケーキとバニラアイスのセット", unitPriceJpy: 600, quantity: 1 },
          { name: "紅茶", unitPriceJpy: 300, quantity: 1 },
        ],
      },
    });
    await writeFile(`${outputDir}/receipt-${dineIn ? "dine-in-" : ""}${size}.pdf`, pdf);
  }
}
void main();
