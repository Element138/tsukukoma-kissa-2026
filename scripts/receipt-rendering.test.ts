import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderReceiptPdf } from "../lib/receipt/render-pdf";
import { receiptHtml, type ReceiptRenderParams } from "../lib/receipt/receipt-html";

async function receipt(size: "small" | "large"): Promise<ReceiptRenderParams> {
  const [regularFontBytes, boldFontBytes, orderNumberFontBytes, logoBytes] = await Promise.all([
    readFile("public/fonts/NotoSansJP-Regular.otf"), readFile("public/fonts/NotoSansJP-Bold.otf"),
    readFile("public/fonts/Lato-Bold.ttf"), readFile("public/receipt/logo.png"),
  ]);
  return { size, regularFontBytes, boldFontBytes, orderNumberFontBytes, logoBytes, data: {
    orderNo: 202, transactionAt: new Date("2026-10-16T01:00:00Z"), fulfillmentType: "DINE_IN", tableNo: 3,
    paymentMethod: "CASH", paymentStatus: "PAID", totalPriceJpy: 300,
    items: [{ name: "<script> & コーヒー", quantity: 1, unitPriceJpy: 300 }],
  } };
}

for (const size of ["small", "large"] as const) {
  test(`${size}: CDN/browser failure returns a single-page PDF with embedded Noto fonts`, async () => {
    const pdf = Buffer.from(await renderReceiptPdf(await receipt(size), async () => { throw new Error("Simulated font CDN failure"); }));
    const contents = pdf.toString("latin1");
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 10000);
    assert.match(contents, /NotoSansJP-Regular/);
    assert.match(contents, /NotoSansJP-Bold/);
    assert.equal([...contents.matchAll(/\/Type\s*\/Page\b/g)].length, 1);
  });
}

test("receipt text is escaped before Adobe's web kit executes", async () => {
  const html = receiptHtml(await receipt("small"));
  assert.ok(html.includes("&lt;script&gt; &amp; コーヒー"));
  assert.ok(!html.includes("<script> & コーヒー"));
  assert.ok(html.includes("jzl2tov"));
});
