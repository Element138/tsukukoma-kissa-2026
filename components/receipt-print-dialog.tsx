"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { receiptPdfPath, RECEIPT_PAPER } from "@/lib/receipt/paper";
import type {
  ReceiptPaperSize,
  ReceiptPrintTarget,
} from "@/lib/receipt/types";

function PrintOption({
  orderId,
  size,
}: {
  orderId: string;
  size: ReceiptPaperSize;
}) {
  const paper = RECEIPT_PAPER[size];

  return (
    <Button asChild size="lg" className="receipt-print-option">
      <a
        href={receiptPdfPath(orderId, size)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Printer aria-hidden="true" />
        <span>
          <strong>{paper.label}</strong>
          <small>
            {paper.printer} · {paper.paperWidthMm} mm PDF
          </small>
        </span>
      </a>
    </Button>
  );
}

export function ReceiptPrintDialog({
  target,
  onClose,
}: {
  target: ReceiptPrintTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="receipt-print-dialog">
        <DialogHeader>
          <DialogTitle>レシート印刷</DialogTitle>
          <DialogDescription>
            注文 #{target?.orderNo ?? "-"} の用紙サイズを選択してください。
            PDFは新しいタブで開きます。
          </DialogDescription>
        </DialogHeader>

        {target ? (
          <div className="receipt-print-options">
            <PrintOption orderId={target.id} size="large" />
            <PrintOption orderId={target.id} size="small" />
          </div>
        ) : null}

        <p className="receipt-print-note">
          印刷しない場合は閉じて注文画面へ戻れます。再印刷はオーダーブックから行えます。
        </p>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              印刷せず閉じる
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
