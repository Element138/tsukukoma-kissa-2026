import { PAYMENT_METHOD_LABEL, labelOf } from "@/lib/labels";
import { formatTokyo } from "@/lib/time";
import { RECEIPT_PAPER } from "@/lib/receipt/paper";
import type { ReceiptData, ReceiptPaperSize } from "@/lib/receipt/types";

export type ReceiptRenderParams = {
  data: ReceiptData;
  size: ReceiptPaperSize;
  regularFontBytes: Uint8Array;
  boldFontBytes: Uint8Array;
  orderNumberFontBytes: Uint8Array;
  logoBytes: Uint8Array;
  renderOrigin?: string;
};

const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]!));
const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;

export function receiptHtml(params: ReceiptRenderParams) {
  const { data, size } = params;
  const paper = RECEIPT_PAPER[size];
  const row = (left: string, right: string, className = "") => `<div class="row ${className}"><span>${escapeHtml(left)}</span><span>${escapeHtml(right)}</span></div>`;
  const numberWidthPt = paper.printableWidthMm * 72 / 25.4 * .78;
  const numberSize = Math.min(size === "small" ? 38 : 48, numberWidthPt / (String(data.orderNo).length * .65));
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>KISSa receipt #${escapeHtml(data.orderNo)}</title>
<style>
/* Adobe 400 is L: receipts use only M (500) and B (600). Noto uses Regular/Bold. */
@font-face { font-family: ReceiptNoto; font-style: normal; font-weight: 500; src: url(data:font/otf;base64,${Buffer.from(params.regularFontBytes).toString("base64")}) format("opentype"); }
@font-face { font-family: ReceiptNoto; font-style: normal; font-weight: 600; src: url(data:font/otf;base64,${Buffer.from(params.boldFontBytes).toString("base64")}) format("opentype"); }
@page { margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; width: ${paper.pdfWidthMm}mm; color: #000; background: #fff; }
body { font-family: "dnp-shuei-gothic-kin-std", ReceiptNoto, sans-serif; font-weight: 500; font-synthesis: none; font-size: ${paper.bodyFontPt}pt; line-height: 1.42; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
main { width: ${paper.pdfWidthMm}mm; padding: ${paper.verticalMarginMm}mm ${paper.horizontalMarginMm}mm; }
header { display: grid; grid-template-columns: ${size === "small" ? 15 : 19}mm minmax(0,1fr); gap: 3mm; margin-bottom: 4mm; }
.logo { width: 100%; display: block; }
.brand { display: flex; flex-direction: column; justify-content: space-between; padding-bottom: .7mm; font-weight: 600; }
.fulfillment { text-align: center; font-size: ${size === "small" ? 10 : 12}pt; padding: .7mm 1mm; border: .3mm solid #000; }
.takeout { background: #000; color: #fff; }
.shop-name { font-size: ${paper.bodyFontPt * 1.12}pt; margin-top: 1mm; }
.shop-reading { font-size: ${paper.bodyFontPt * 1.25}pt; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; flex-wrap: wrap; }
.row span:last-child { margin-left: auto; text-align: right; }
hr { margin: 1.6mm 0; border: 0; border-top: .23mm solid #000; }
h1, h2, p { margin: 0; font-size: inherit; }
h2 { font-weight: 600; margin-bottom: .8mm; }
.item { margin-bottom: 1.25mm; }
.item-name { font-size: ${paper.itemFontPt}pt; font-weight: 600; overflow-wrap: anywhere; line-break: strict; text-wrap: balance; }
.total { font-weight: 600; font-size: ${size === "small" ? 11 : 13}pt; }
.order-number { margin-top: 6mm; text-align: center; font-weight: 600; }
.number-badge { margin: 1mm auto 0; width: 78%; padding: 3.5mm 0; background: #000; color: #fff; font-size: ${numberSize}pt; line-height: 1; }
footer { text-align: center; margin-top: 4mm; }
.thanks { font-weight: 600; }
.instruction { font-size: ${paper.bodyFontPt * .82}pt; }
</style></head><body><main>
<header><img class="logo" alt="" src="data:image/png;base64,${Buffer.from(params.logoBytes).toString("base64")}"><div class="brand">
<div class="fulfillment ${data.fulfillmentType === "TAKEOUT" ? "takeout" : ""}">${data.fulfillmentType === "TAKEOUT" ? "持ち帰り" : "店内"}</div>
<div><div class="shop-name">筑駒75期喫茶</div><div class="shop-reading">かわせみ</div></div></div></header>
${data.tableNo == null ? "" : row("テーブル", String(data.tableNo))}
${row("会計日時", formatTokyo(data.transactionAt))}${row("決済", labelOf(PAYMENT_METHOD_LABEL, data.paymentMethod))}<hr>
<h2>ご注文内容</h2>${data.items.map(item => `<section class="item"><p class="item-name">${escapeHtml(item.name)}</p>${row(`${item.quantity} × ${yen(item.unitPriceJpy)}`, yen(item.quantity * item.unitPriceJpy))}</section>`).join("")}
<hr>${row("合計", yen(data.totalPriceJpy), "total")}
<div class="order-number"><p>ご注文番号</p><p class="number-badge">${escapeHtml(data.orderNo)}</p></div>
<footer><p class="thanks">ありがとうございました</p><p class="instruction">受け取り時にお見せください</p></footer>
</main><script>
// The font kit is hosted by Adobe; no Adobe font files are stored on our server.
window.receiptFonts = "loading";
(function(d) {
  var config = { kitId: 'jzl2tov', scriptTimeout: 3000, async: true },
  h=d.documentElement,t=setTimeout(function(){h.className=h.className.replace(/\\bwf-loading\\b/g,"")+" wf-inactive";},config.scriptTimeout),tk=d.createElement("script"),f=false,s=d.getElementsByTagName("script")[0],a;
  h.className+=" wf-loading";tk.src='https://use.typekit.net/'+config.kitId+'.js';tk.async=true;
  tk.onerror=function(){window.receiptFonts="failed";clearTimeout(t);};
  tk.onload=tk.onreadystatechange=function(){a=this.readyState;if(f||a&&a!="complete"&&a!="loaded")return;f=true;clearTimeout(t);try{Typekit.load({
    active:function(){window.receiptFonts="active";},inactive:function(){window.receiptFonts="failed";}
  });}catch(e){window.receiptFonts="failed";}};
  s.parentNode.insertBefore(tk,s);
})(document);
</script></body></html>`;
}
