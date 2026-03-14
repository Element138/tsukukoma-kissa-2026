import { z } from "zod";

export const actorTypeSchema = z.enum(["POS", "KITCHEN", "WAITER", "MENU_DISPLAY", "ADMIN"]);

export const loginSchema = z.object({
  actorId: z.string().min(1).max(64),
  secret: z.string().min(1).max(128)
});

export const orderItemInputSchema = z.object({
  menuId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20)
});

export const orderCreateSchema = z
  .object({
    fulfillmentType: z.enum(["DINE_IN", "TAKEOUT"]),
    tableNo: z.number().int().positive().nullable().optional(),
    partySize: z.number().int().min(1).max(50),
    ageRanges: z.array(z.string().min(1).max(32)).min(1),
    specialNote: z.string().max(500).optional(),
    paymentMethod: z.enum(["CASH", "SQUARE", "PAYMENT_SKIPPED"]),
    paymentSkipReasonType: z.enum(["TEST", "DEVICE_ERROR", "NETWORK_ERROR", "OTHER"]).nullable().optional(),
    paymentSkipReasonText: z.string().max(300).nullable().optional(),
    items: z.array(orderItemInputSchema).min(1).max(80),
    idempotencyKey: z.string().min(8).max(128)
  })
  .superRefine((v, ctx) => {
    if (v.fulfillmentType === "DINE_IN" && (!v.tableNo || v.tableNo <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "tableNo is required for DINE_IN", path: ["tableNo"] });
    }
    if (v.fulfillmentType === "TAKEOUT" && v.tableNo != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "tableNo must be null for TAKEOUT", path: ["tableNo"] });
    }
    if (v.ageRanges.length !== v.partySize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ageRanges length must match partySize",
        path: ["ageRanges"]
      });
    }
    if (v.paymentMethod === "PAYMENT_SKIPPED" && !v.paymentSkipReasonType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "paymentSkipReasonType is required for PAYMENT_SKIPPED",
        path: ["paymentSkipReasonType"]
      });
    }
  });

export const orderConfirmSchema = z.object({
  result: z.enum(["SUCCESS", "FAILED"]),
  squareTransactionId: z.string().max(120).optional(),
  reasonText: z.string().max(500).optional()
});

export const orderCancelSchema = z.object({
  reasonText: z.string().max(500).optional()
});

export const specialNoteSchema = z.object({
  specialNote: z.string().max(500)
});

export const itemReadySchema = z.object({
  expectedItemStatus: z.enum(["QUEUED"])
});

export const kitchenMenuReadySchema = z.object({
  menuId: z.string().uuid(),
  quantity: z.number().int().min(1).max(999),
  idempotencyKey: z.string().min(8).max(160)
});

export const serveItemSchema = z.object({
  orderItemId: z.string().uuid(),
  expectedItemStatus: z.enum(["READY"])
});

export const serveOrderSchema = z.object({
  orderId: z.string().min(1)
});

export const undoSchema = z.object({
  confirm: z.literal(true)
});

export const kitchenToggleSchema = z.object({
  kitchenId: z.string().min(1).max(64),
  kitchenEnabled: z.boolean()
});

export const kitchenReassignSchema = z.object({
  fromKitchenId: z.string().min(1).max(64),
  toKitchenId: z.string().min(1).max(64)
});

export const availabilityUpdateSchema = z.object({
  menuId: z.string().uuid(),
  availability: z.enum(["AVAILABLE", "PAUSED", "SOLD_OUT"])
});

export const actorCreateSchema = z
  .object({
    actorType: actorTypeSchema,
    label: z.string().min(1).max(120),
    secret: z.string().min(4).max(128),
    kitchenEnabled: z.boolean().optional(),
    kitchenDisplayOrder: z.number().int().min(0).max(999).optional()
  })
  .strict()
  .superRefine((v, ctx) => {
    const hasKitchenFields = typeof v.kitchenEnabled === "boolean" || typeof v.kitchenDisplayOrder === "number";
    if (v.actorType !== "KITCHEN" && hasKitchenFields) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "kitchenEnabled / kitchenDisplayOrder are allowed only for KITCHEN actor",
        path: ["actorType"]
      });
    }
  });

export const actorUpdateSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(120).optional(),
    secret: z.string().min(4).max(128).optional(),
    kitchenEnabled: z.boolean().optional(),
    kitchenDisplayOrder: z.number().int().min(0).max(999).optional()
  })
  .strict()
  .refine((v) => Object.keys(v).some((key) => key !== "id"), {
    message: "At least one field to update is required"
  });

const specifiedAllergenSchema = z.enum([
  "EGG",
  "MILK",
  "WHEAT",
  "SHRIMP",
  "CRAB",
  "WALNUT",
  "PEANUT",
  "BUCKWHEAT",
]);
const menuAllergensSchema = z
  .array(specifiedAllergenSchema)
  .max(8)
  .transform((values) => [...new Set(values)]);
const badgeColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const menuCreateSchema = z.object({
  name: z.string().min(1).max(120),
  priceJpy: z.number().int().min(0).max(100000),
  availability: z.enum(["AVAILABLE", "PAUSED", "SOLD_OUT"]),
  workloadSeconds: z.number().finite().min(0.1).max(7200),
  displayOrder: z.number().int().min(0).max(999),
  categoryId: z.string().uuid(),
  showLeadTime: z.boolean().optional(),
  coverImageDataUrl: z.string().max(2_000_000).nullable().optional(),
  allergensJson: menuAllergensSchema.optional(),
  customBadgeText: z.string().trim().max(32).nullable().optional(),
  customBadgeColor: badgeColorSchema.nullable().optional(),
});

export const menuUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  priceJpy: z.number().int().min(0).max(100000).optional(),
  availability: z.enum(["AVAILABLE", "PAUSED", "SOLD_OUT"]).optional(),
  workloadSeconds: z.number().finite().min(0.1).max(7200).optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  categoryId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  showLeadTime: z.boolean().optional(),
  coverImageDataUrl: z.string().max(2_000_000).nullable().optional(),
  allergensJson: menuAllergensSchema.optional(),
  customBadgeText: z.string().trim().max(32).nullable().optional(),
  customBadgeColor: badgeColorSchema.nullable().optional(),
});

export const assignmentUpsertSchema = z.object({
  menuId: z.string().uuid(),
  kitchenId: z.string().min(1).max(64),
  enabled: z.boolean()
});
