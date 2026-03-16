import { Prisma, PrismaClient } from "@prisma/client";
import { buildLateSuccessIncidentMessage } from "@/lib/domain/order-processing-trace";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function openLateSuccessIncident(
  db: DbClient,
  params: {
    orderId: string;
    orderNo: number;
    responsiblePosActorId: string;
    squareTransactionId: string | null;
    orderCreatedAt: Date;
    failedAt: Date | null;
    failureReasonType: string | null;
    failureReasonText: string | null;
    successCallbackAt: Date;
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
      messageJa: buildLateSuccessIncidentMessage({
        orderNo: params.orderNo,
        createdAt: params.orderCreatedAt,
        failedAt: params.failedAt,
        failureReasonType: params.failureReasonType,
        failureReasonText: params.failureReasonText,
        successCallbackAt: params.successCallbackAt,
      }),
      detailsJson: {
        responsiblePosActorId: params.responsiblePosActorId,
        squareTransactionId: params.squareTransactionId,
        orderCreatedAt: params.orderCreatedAt.toISOString(),
        failedAt: params.failedAt?.toISOString() ?? null,
        failureReasonType: params.failureReasonType,
        failureReasonText: params.failureReasonText,
        successCallbackAt: params.successCallbackAt.toISOString(),
      },
    },
  });
}
