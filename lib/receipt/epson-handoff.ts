// TM Print Assistant's print protocol; no public receipt URL or session cookie
// is passed to the native app. Keep the payload transient in browser memory.
const MAX_PDF_BYTES = 150 * 1024;
const MAX_HANDOFF_LENGTH = 200 * 1024;

export function isAppleMobileDevice(userAgent: string, maxTouchPoints: number) {
  return /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export function epsonPdfHandoff(pdf: Uint8Array, returnUrl: string) {
  if (pdf.length === 0 || pdf.length > MAX_PDF_BYTES) {
    throw new Error("PDFが大きすぎるためアプリへ送信できません。PDFプレビューをご利用ください。");
  }
  if (String.fromCharCode(...pdf.subarray(0, 5)) !== "%PDF-") {
    throw new Error("レシートPDFを取得できませんでした。");
  }
  const callback = new URL(returnUrl);
  if (!["http:", "https:"].includes(callback.protocol)) {
    throw new Error("POSの戻り先URLが無効です。");
  }
  let binary = "";
  for (let offset = 0; offset < pdf.length; offset += 8192) {
    binary += String.fromCharCode(...pdf.subarray(offset, offset + 8192));
  }
  const parameters: Record<string, string> = {
    ver: "1",
    "data-type": "pdf",
    data: btoa(binary),
    success: callback.href,
    "error-dialog": "yes",
    reselect: "yes",
    timeout: "60000",
    // Feed the receipt to the tear/cut position after printing. On the manual-
    // cutter TM-P80II this feeds paper only; do not use a full-cut request.
    cut: "feed",
    "fit-to-width": "yes",
    "printable-width": "72",
    "paper-width": "80",
  };
  // encodeURIComponent rather than form encoding: Epson expects URL-encoded
  // Base64, including literal '+' encoded as %2B (not spaces).
  const query = Object.entries(parameters)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  const url = `tmprintassistant://tmprintassistant.epson.com/print?${query}`;
  if (url.length > MAX_HANDOFF_LENGTH) {
    throw new Error("PDFが大きすぎるためアプリへ送信できません。PDFプレビューをご利用ください。");
  }
  return url;
}
