import PDFDocument from "pdfkit";
import {
  PAYMENT_METHOD_LABEL,
  labelOf,
} from "@/lib/labels";
import { formatTokyo } from "@/lib/time";
import { mmToPoints, RECEIPT_PAPER } from "@/lib/receipt/paper";
import type { ReceiptData, ReceiptPaperSize } from "@/lib/receipt/types";

type FontWeight = "regular" | "bold" | "order-number";

type TextCommand = {
  kind: "text";
  text: string;
  top: number;
  x: number;
  size: number;
  fontWeight: FontWeight;
};

type RuleCommand = {
  kind: "rule";
  top: number;
  thickness: number;
};

type LayoutCommand = TextCommand | RuleCommand | { kind: "logo"; top: number; width: number; height: number } | { kind: "badge"; top: number; text: string; width: number; height: number; inverted: boolean; size: number; align?: "right"; fontWeight?: FontWeight };

function formatYen(value: number) {
  return `¥${value.toLocaleString("ja-JP")}`;
}

function wrapText(
  text: string,
  measure: (value: string) => number,
  maxWidth: number,
) {
  const lines: string[] = [];
  let current = "";

  for (const character of Array.from(text)) {
    if (character === "\n") {
      lines.push(current);
      current = "";
      continue;
    }

    const candidate = `${current}${character}`;
    if (current && measure(candidate) > maxWidth) {
      lines.push(current.trimEnd());
      current = character.trimStart();
    } else {
      current = candidate;
    }
  }

  if (current || lines.length === 0) {
    lines.push(current);
  }

  // Avoid leaving one or two Japanese glyphs alone on the final line.
  if (lines.length > 1 && Array.from(lines[lines.length - 1]).length < 3) {
    const previous = Array.from(lines[lines.length - 2]);
    let last = lines[lines.length - 1];
    while (previous.length > 3 && Array.from(last).length < 3) {
      const candidate = previous[previous.length - 1] + last;
      if (measure(candidate) > maxWidth) break;
      last = previous.pop()! + last;
    }
    lines[lines.length - 2] = previous.join("");
    lines[lines.length - 1] = last;
  }

  return lines;
}

export async function renderReceiptPdfFallback(params: {
  data: ReceiptData;
  size: ReceiptPaperSize;
  regularFontBytes: Uint8Array;
  boldFontBytes: Uint8Array;
  orderNumberFontBytes: Uint8Array;
  logoBytes: Uint8Array;
}) {
  const { data, size, regularFontBytes, boldFontBytes } = params;
  const paper = RECEIPT_PAPER[size];
  const pageWidth = mmToPoints(paper.paperWidthMm);
  const contentLeft = mmToPoints(paper.horizontalMarginMm);
  const contentWidth = mmToPoints(paper.printableWidthMm);
  const verticalMargin = mmToPoints(paper.verticalMarginMm);
  const bodySize = paper.bodyFontPt;
  const commands: LayoutCommand[] = [];
  let cursor = verticalMargin;

  const document = new PDFDocument({
    autoFirstPage: false,
    bufferPages: false,
    compress: true,
    // PDFKit defaults to Helvetica before our embedded Japanese fonts are
    // registered. Passing null skips that unused standard-font lookup.
    // @types/pdfkit has not yet added the documented null option.
    font: null as never,
    info: {
      Title: `KISSa receipt #${data.orderNo}`,
      Author: "KISSa POS",
      Creator: "KISSa POS",
      Producer: "KISSa POS receipt service",
      CreationDate: data.transactionAt,
      ModDate: data.transactionAt,
    },
  });
  document.registerFont("regular", Buffer.from(regularFontBytes));
  document.registerFont("bold", Buffer.from(boldFontBytes));
  document.registerFont("order-number", Buffer.from(params.orderNumberFontBytes));

  const inkBounds = (text: string, fontSize: number, fontWeight: FontWeight = "bold") => {
    document.font(fontWeight);
    // PDFKit's embedded font wraps fontkit. The ink bounds exclude invisible
    // line-box whitespace, so padding remains equal around the visible digits.
    const embedded = (document as unknown as {
      _font: { font: {
        unitsPerEm: number;
        layout: (text: string) => { glyphs: Array<{
          bbox: { minY: number; maxY: number };
        }> };
      } };
    })._font.font;
    const glyphs = embedded.layout(text).glyphs;
    const minY = Math.min(...glyphs.map((glyph) => glyph.bbox.minY));
    const maxY = Math.max(...glyphs.map((glyph) => glyph.bbox.maxY));
    const scale = fontSize / embedded.unitsPerEm;
    return { height: (maxY - minY) * scale, top: maxY * scale };
  };

  const measure = (text: string, fontWeight: FontWeight, fontSize: number) =>
    document.font(fontWeight).fontSize(fontSize).widthOfString(text, {
      lineBreak: false,
    });

  const addText = (
    text: string,
    options?: {
      size?: number;
      fontWeight?: FontWeight;
      align?: "left" | "center" | "right";
      maxWidth?: number;
      lineHeight?: number;
    },
  ) => {
    const fontSize = options?.size ?? bodySize;
    const fontWeight = options?.fontWeight ?? "regular";
    const maxWidth = options?.maxWidth ?? contentWidth;
    const lineHeight = options?.lineHeight ?? fontSize * 1.38;
    const lines = wrapText(
      text,
      (value) => measure(value, fontWeight, fontSize),
      maxWidth,
    );

    for (const line of lines) {
      const textWidth = measure(line, fontWeight, fontSize);
      const x =
        options?.align === "center"
          ? (contentWidth - textWidth) / 2
          : options?.align === "right"
            ? contentWidth - textWidth
            : 0;
      commands.push({
        kind: "text",
        text: line,
        top: cursor,
        x: Math.max(0, x),
        size: fontSize,
        fontWeight,
      });
      cursor += lineHeight;
    }
  };

  const addRow = (
    left: string,
    right: string,
    options?: { size?: number; fontWeight?: FontWeight },
  ) => {
    const fontSize = options?.size ?? bodySize;
    const fontWeight = options?.fontWeight ?? "regular";
    const gap = mmToPoints(2);
    const leftWidth = measure(left, fontWeight, fontSize);
    const rightWidth = measure(right, fontWeight, fontSize);
    const lineHeight = fontSize * 1.42;

    if (leftWidth + rightWidth + gap <= contentWidth) {
      commands.push({
        kind: "text",
        text: left,
        top: cursor,
        x: 0,
        size: fontSize,
        fontWeight,
      });
      commands.push({
        kind: "text",
        text: right,
        top: cursor,
        x: contentWidth - rightWidth,
        size: fontSize,
        fontWeight,
      });
      cursor += lineHeight;
      return;
    }

    addText(left, { size: fontSize, fontWeight });
    addText(right, {
      size: fontSize,
      fontWeight,
      align: "right",
    });
  };

  const addRule = (
    spaceBefore = mmToPoints(1.6),
    spaceAfter = mmToPoints(1.6),
  ) => {
    cursor += spaceBefore;
    commands.push({ kind: "rule", top: cursor, thickness: 0.65 });
    cursor += spaceAfter;
  };

  const logoWidth = mmToPoints(size === "small" ? 15 : 19);
  const logoHeight = logoWidth * 1205 / 943;
  commands.push({ kind: "logo", top: cursor, width: logoWidth, height: logoHeight });
  const headerX = logoWidth + mmToPoints(3);
  const headerWidth = contentWidth - headerX;
  const badgeSize = size === "small" ? 10 : 12;
  if (data.fulfillmentType === "TAKEOUT") {
    commands.push({ kind: "badge", top: cursor, text: "持ち帰り", width: headerWidth, height: badgeSize * 1.8, inverted: true, size: badgeSize, align: "right" });
  } else if (data.fulfillmentType === "DINE_IN") {
    commands.push({ kind: "badge", top: cursor, text: "店内", width: headerWidth, height: badgeSize * 1.8, inverted: false, size: badgeSize, align: "right" });
  }
  commands.push({ kind: "text", text: "筑駒75期喫茶", top: cursor + logoHeight - bodySize * 3.2, x: headerX, size: bodySize * 1.12, fontWeight: "bold" });
  commands.push({ kind: "text", text: "かわせみ", top: cursor + logoHeight - bodySize * 1.65, x: headerX, size: bodySize * 1.25, fontWeight: "bold" });
  cursor += logoHeight + mmToPoints(4);
  if (data.tableNo != null) {
    addRow("テーブル", String(data.tableNo));
  }
  addRow("会計日時", formatTokyo(data.transactionAt));
  addRow("決済", labelOf(PAYMENT_METHOD_LABEL, data.paymentMethod));
  addRule();

  addText("ご注文内容", { fontWeight: "bold" });
  cursor += mmToPoints(0.8);

  for (const item of data.items) {
    addText(item.name, {
      size: paper.itemFontPt,
      fontWeight: "bold",
    });
    addRow(
      `${item.quantity} × ${formatYen(item.unitPriceJpy)}`,
      formatYen(item.unitPriceJpy * item.quantity),
      { size: bodySize },
    );
    cursor += mmToPoints(1.25);
  }

  addRule(mmToPoints(0.7), mmToPoints(2));
  addRow("合計", formatYen(data.totalPriceJpy), {
    size: size === "large" ? 13 : 11,
    fontWeight: "bold",
  });

  cursor += mmToPoints(6);
  addText("ご注文番号", { fontWeight: "bold", align: "center" });
  cursor += mmToPoints(1);
  const numberWidth = contentWidth * 0.78;
  const numberSize = Math.min(size === "small" ? 38 : 48, numberWidth / (String(data.orderNo).length * 0.65));
  const numberVerticalPadding = mmToPoints(3.5);
  const numberHeight = inkBounds(String(data.orderNo), numberSize, "order-number").height + numberVerticalPadding * 2;
  commands.push({ kind: "badge", top: cursor, text: String(data.orderNo), width: numberWidth, height: numberHeight, inverted: true, size: numberSize, fontWeight: "order-number" });
  cursor += numberHeight + mmToPoints(4);
  addText("ありがとうございました", {
    fontWeight: "bold",
    align: "center",
  });
  addText("受け取り時にお見せください", {
    size: bodySize * 0.82,
    align: "center",
  });

  const pageHeight = Math.max(
    cursor + verticalMargin,
    mmToPoints(size === "large" ? 88 : 78),
  );

  document.addPage({
    size: [pageWidth, pageHeight],
    margin: 0,
  });

  for (const command of commands) {
    if (command.kind === "logo") {
      document.image(Buffer.from(params.logoBytes), contentLeft, command.top, { width: command.width, height: command.height });
      continue;
    }
    if (command.kind === "badge") {
      const x = command.align === "right" ? contentLeft + contentWidth - command.width : contentLeft + (contentWidth - command.width) / 2;
      document.save().lineWidth(0.8).rect(x, command.top, command.width, command.height);
      if (command.inverted) document.fill("black"); else document.stroke("black");
      const fontWeight = command.fontWeight ?? "bold";
      document.font(fontWeight).fontSize(command.size);
      let textY = command.top + (command.height - command.size * 1.45) / 2;
      if (command.inverted) {
        const ink = inkBounds(command.text, command.size, fontWeight);
        textY = command.top + (command.height - ink.height) / 2 + ink.top;
      }
      document.fillColor(command.inverted ? "white" : "black").text(
        command.text,
        x + (command.width - measure(command.text, fontWeight, command.size)) / 2,
        textY,
        { lineBreak: false, ...(command.inverted ? { baseline: "alphabetic" as const } : {}) },
      );
      document.restore();
      continue;
    }
    if (command.kind === "rule") {
      document
        .save()
        .lineWidth(command.thickness)
        .moveTo(contentLeft, command.top)
        .lineTo(contentLeft + contentWidth, command.top)
        .stroke("black")
        .restore();
      continue;
    }

    document
      .font(command.fontWeight)
      .fontSize(command.size)
      .fillColor("black")
      .text(command.text, contentLeft + command.x, command.top, {
        lineBreak: false,
      });
  }

  const chunks: Buffer[] = [];
  const result = new Promise<Uint8Array>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  document.end();
  return result;
}
