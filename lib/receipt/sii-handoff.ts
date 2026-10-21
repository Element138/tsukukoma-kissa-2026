// SII URL Print Agent Programmer's Guide, URL scheme v1.0 (iOS).
// https://www.sii-ps.com/common/URLPRNAgent_Android_iOS_JA_01.pdf
export function siiPdfHandoff(pdf: Uint8Array, returnUrl: string) {
  if (!pdf.length || pdf.length > 500 * 1024) {
    throw new Error("PDFが大きすぎるためSIIアプリへ送信できません。PDFプレビューをご利用ください。");
  }
  if (String.fromCharCode(...pdf.subarray(0, 5)) !== "%PDF-") {
    throw new Error("レシートPDFを取得できませんでした。");
  }
  const callback = new URL(returnUrl);
  if (!["http:", "https:"].includes(callback.protocol)) throw new Error("POSの戻り先URLが無効です。");
  let binary = "";
  for (let offset = 0; offset < pdf.length; offset += 8192) {
    binary += String.fromCharCode(...pdf.subarray(offset, offset + 8192));
  }
  const parameters = {
    CallbackSuccess: callback.href,
    Format: "pdf",
    Data: btoa(binary),
    BtKeepConnect: "no", // Release the connection after printing for other terminals.
    Timeout: "60000",
    ErrorDialog: "yes",
    SelectOnError: "yes",
    PaperWidth: "58",
    FitToWidth: "yes", // Also rejects receipts beyond SII's 500 mm length limit.
    CutType: "off", // MP-B20 has a manual tear bar, not an automatic cutter.
    CutFeed: "yes",
  };
  const query = Object.entries(parameters).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  const url = `siiprintagent://1.0/print?${query}`;
  if (url.length > 750 * 1024) {
    throw new Error("PDFが大きすぎるためSIIアプリへ送信できません。PDFプレビューをご利用ください。");
  }
  return url;
}
