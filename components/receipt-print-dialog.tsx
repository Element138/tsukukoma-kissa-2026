"use client";

import { Printer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
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
import { epsonPdfHandoff, isAppleMobileDevice } from "@/lib/receipt/epson-handoff";
import { siiPdfHandoff } from "@/lib/receipt/sii-handoff";
import type {
  ReceiptPaperSize,
  ReceiptPrintTarget,
} from "@/lib/receipt/types";

function NativePrintOption({ orderId, size, refundId }: { orderId: string; size: ReceiptPaperSize; refundId?: string }) {
  const paper = RECEIPT_PAPER[size];
  const appName = size === "large" ? "TM Print Assistant" : "SII URL Print Agent";
  const [href, setHref] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [launched, setLaunched] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setHref(null);
    setError("");
    setLaunched(false);
    async function prepare() {
      try {
        const response = await fetch(receiptPdfPath(orderId, size, refundId), {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error?.message ?? "レシートを取得できませんでした。ログイン状態をご確認ください。");
        }
        if (!response.headers.get("content-type")?.includes("application/pdf")) {
          throw new Error("PDFを取得できませんでした。ログイン状態をご確認ください。");
        }
        const pdf = new Uint8Array(await response.arrayBuffer());
        const url = (size === "large" ? epsonPdfHandoff : siiPdfHandoff)(pdf, window.location.href);
        if (!controller.signal.aborted) setHref(url);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "レシートの準備に失敗しました。");
        }
      }
    }
    void prepare();
    return () => controller.abort();
  }, [orderId, size, refundId, attempt]);

  return (
    <div className="grid gap-2">
      {href ? (
        <Button asChild size="lg" className="receipt-print-option">
          {/* A real tap on the prepared link preserves iOS user activation. */}
          <a href={href} onClick={() => setLaunched(true)}>
            <Printer aria-hidden="true" />
            <span><strong>{paper.label}</strong><small>{appName}で印刷 · {paper.printer}</small></span>
          </a>
        </Button>
      ) : (
        <Button size="lg" className="receipt-print-option" disabled>
          <Printer aria-hidden="true" />
          <span><strong>{paper.label}</strong><small>{error ? "準備できませんでした" : "PDFを準備中…"}</small></span>
        </Button>
      )}
      <p className="receipt-print-note" role="status" aria-live="polite">
        {error || (launched
          ? `アプリが開かない場合は${appName}のインストールをご確認ください。印刷結果はアプリで確認してください。`
          : size === "large"
            ? "初回はTM Print AssistantでTM-P80IIを選択し、通信テストを行ってください。PDF印刷はBluetooth ClassicまたはWi-Fiを使用します（BLE不可）。"
            : "初回はiPadとMP-B20をBluetoothでペアリングし、SII URL Print Agentでプリンターを選択してください。印刷後は紙を手で切り取ります。")}
      </p>
      {error ? <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>再試行</Button> : null}
      <a className="text-sm underline" href={receiptPdfPath(orderId, size, refundId)} target="_blank" rel="noopener noreferrer">PDFをプレビュー（{size === "large" ? "大" : "小"}）</a>
    </div>
  );
}

function PrintOption({
  orderId,
  size,
  refundId,
}: {
  orderId: string;
  size: ReceiptPaperSize;
  refundId?: string;
}) {
  const paper = RECEIPT_PAPER[size];
  const [appleMobile, setAppleMobile] = useState<boolean | null>(null);
  useEffect(() => {
    setAppleMobile(isAppleMobileDevice(navigator.userAgent, navigator.maxTouchPoints));
  }, []);
  if (appleMobile === null) {
    return <Button size="lg" className="receipt-print-option" disabled>{paper.label}を準備中…</Button>;
  }
  if (appleMobile) return <NativePrintOption key={`${orderId}-${refundId ?? "sale"}-${size}`} orderId={orderId} size={size} refundId={refundId} />;

  return (
    <Button asChild size="lg" className="receipt-print-option">
      <a
        href={receiptPdfPath(orderId, size, refundId)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Printer aria-hidden="true" />
        <span>
          <strong>{paper.label}</strong>
          <small>
            {paper.printer} · {paper.pdfWidthMm} mm PDF
          </small>
        </span>
      </a>
    </Button>
  );
}

export function ReceiptPrintDialog({
  target,
  onClose,
  additionalAction,
}: {
  target: ReceiptPrintTarget | null;
  onClose: () => void;
  additionalAction?: ReactNode;
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
        <DialogHeader className="receipt-print-header">
          <DialogTitle>{target?.refundId ? "返金レシート印刷" : "レシート印刷"}</DialogTitle>
          <DialogDescription>
            注文 #{target?.orderNo ?? "-"} の用紙サイズを選択してください。
            iPad/iPhoneでは各プリンター用アプリ、PCではPDFを開きます。
          </DialogDescription>
        </DialogHeader>

        <div className="receipt-print-body">
          {target ? (
            <div className="receipt-print-options">
              <PrintOption orderId={target.id} refundId={target.refundId} size="large" />
              <PrintOption orderId={target.id} refundId={target.refundId} size="small" />
            </div>
          ) : null}

          <p className="receipt-print-note">
            印刷しない場合は閉じて注文画面へ戻れます。再印刷はオーダーブックから行えます。
          </p>

          <DialogFooter>
            {additionalAction}
            <DialogClose asChild>
              <Button type="button" variant="outline">印刷せず閉じる</Button>
            </DialogClose>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
