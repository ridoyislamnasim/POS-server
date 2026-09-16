import { z } from "zod";

export const createSaleSchema = z.object({
  branchId: z.string(),
  registerId: z.string(),
  deviceId: z.string(),
  deviceSequence: z.number().optional(),
  clientTransactionId: z.string(),
  customerId: z.string().optional(),
  channel: z.enum(["STORE", "ONLINE", "MARKETPLACE"]).optional(),
  transactionDiscount: z.string().optional(),
  transactionDiscountPercent: z.string().optional(),
  transactionDiscountReason: z.string().optional(),
  items: z
    .array(
      z.object({
        variantId: z.string(),
        qty: z.number().positive(),
        discountAmount: z.string().optional(),
        discountPercent: z.string().optional(),
        discountReason: z.string().optional(),
        associateId: z.string().optional(),
      }),
    )
    .min(1),
  payments: z
    .array(
      z.object({
        method: z.string(),
        amount: z.string(),
        status: z
          .enum(["PENDING", "AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"])
          .optional(),
      }),
    )
    .min(1),
});

export const createSaleReturnSchema = z.object({
  kind: z.enum(["RETURN", "EXCHANGE"]).default("RETURN"),
  reason: z.string().min(1),
  notes: z.string().optional(),
  refundMethod: z.enum(["CASH", "CARD", "MFS", "STORE_CREDIT"]).optional(),
  restock: z.boolean().optional(),
  items: z
    .array(
      z.object({
        saleItemId: z.string(),
        qty: z.number().positive(),
        restock: z.boolean().optional(),
        reason: z.string().optional(),
        notes: z.string().optional(),
        condition: z.enum(["GOOD", "DAMAGED", "DEFECTIVE", "EXPIRED", "MISSING_PARTS", "RESTOCK_NOT_ALLOWED"]).optional(),
      }),
    )
    .min(1),
  exchangeItems: z
    .array(z.object({ variantId: z.string(), qty: z.number().positive() }))
    .optional(),
});

export const holdSaleSchema = z.object({
  // NOTE: branchId presence/validity is enforced by the holds service via
  // assertBranch (403 on failure) to preserve the legacy behavior exactly.
  branchId: z.string().optional(),
  payload: z.unknown().optional(),
}).passthrough();

export const voidSaleSchema = z.object({
  reason: z.string().min(1, "reason required"),
});

export type CreateSaleBody = z.infer<typeof createSaleSchema>;
export type CreateSaleReturnBody = z.infer<typeof createSaleReturnSchema>;
export type HoldSaleBody = z.infer<typeof holdSaleSchema>;
export type VoidSaleBody = z.infer<typeof voidSaleSchema>;
