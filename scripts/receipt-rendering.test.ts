import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createReceiptPdfRenderer, renderReceiptPdf } from "../lib/receipt/render-pdf";
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
    const box = contents.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    assert.ok(box, "PDF must declare its page dimensions");
    assert.ok(Math.abs(Number(box[1]) * 25.4 / 72 - (size === "small" ? 48 : 79.5)) < 0.01);
  });
}

test("receipt text is escaped before Adobe's web kit executes", async () => {
  const html = receiptHtml(await receipt("small"));
  assert.ok(html.includes("&lt;script&gt; &amp; コーヒー"));
  assert.ok(!html.includes("<script> & コーヒー"));
  assert.ok(html.includes("jzl2tov"));
});

test("small HTML uses the MP-B20 print-area canvas without changing vertical padding", async () => {
  const html = receiptHtml(await receipt("small"));
  assert.ok(html.includes("width: 48mm"));
  assert.ok(html.includes("padding: 8.5mm 2mm"));
  assert.ok(!html.includes("width: 58mm"));
});

test("reopening an unchanged Adobe receipt uses the completed PDF during a later outage", async () => {
  let attempts = 0;
  const adobe = Buffer.from("completed Adobe receipt");
  const render = createReceiptPdfRenderer(async () => {
    attempts++;
    if (attempts > 1) throw new Error("CDN became unavailable");
    return adobe;
  });
  const params = await receipt("small");
  assert.equal(await render(params), adobe);
  assert.equal(await render(params), adobe);
  assert.equal(attempts, 1);
});

test("fallback is not cached and simultaneous reopenings share one successful render", async () => {
  let attempts = 0;
  const adobe = Buffer.from("Adobe");
  const noto = Buffer.from("Noto");
  const render = createReceiptPdfRenderer(async () => {
    attempts++;
    if (attempts === 1) throw new Error("Temporary font outage");
    return adobe;
  }, async () => noto);
  const params = await receipt("large");
  assert.equal(await render(params), noto);
  assert.deepEqual(await Promise.all([render(params), render(params)]), [adobe, adobe]);
  assert.equal(attempts, 2);
  assert.equal(await render({ ...params, data: { ...params.data, orderNo: 999 } }), adobe);
  assert.equal(attempts, 3);
});
