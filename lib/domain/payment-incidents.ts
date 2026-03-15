import { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function openLateSuccessIncident(
  db: DbClient,
  params: {
    orderId: string;
    orderNo: number;
    responsiblePosActorId: string;
    squareTransactionId: string | null;
  },
) {
  const existing = await db.paymentIncident.findFirst({
    where: {
      orderId: params.orderId,
      incidentType: "LATE_SUCCESS_AFTER_FAILED",
      dismissedAt: null,
    },
  });
  if (existing) {
    return existing;
  }

  return db.paymentIncident.create({
    data: {
      orderId: params.orderId,
      incidentType: "LATE_SUCCESS_AFTER_FAILED",
      messageJa: `注文 #${params.orderNo} で失敗確定後にSUCCESSコールバックを受信しました。入金有無を確認してください。`,
      detailsJson: {
        responsiblePosActorId: params.responsiblePosActorId,
        squareTransactionId: params.squareTransactionId,
      },
    },
  });
}
