export type ReceiptPaperSize = "large" | "small";

export type ReceiptLineItem = {
  name: string;
  unitPriceJpy: number;
  quantity: number;
};

export type ReceiptData = {
  orderNo: number;
  transactionAt: Date;
  fulfillmentType: string;
  tableNo: number | null;
  paymentMethod: string;
  paymentStatus: string;
  totalPriceJpy: number;
  items: ReceiptLineItem[];
};

export type ReceiptPrintTarget = {
  id: string;
  orderNo: number;
};
