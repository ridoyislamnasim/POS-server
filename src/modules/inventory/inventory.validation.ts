import { z } from "zod";

export const adjustStockSchema = z.object({
  variantId: z.string().min(1, "variantId, locationId, direction, quantity, reason required"),
  locationId: z.string().min(1, "variantId, locationId, direction, quantity, reason required"),
  direction: z.string().min(1, "variantId, locationId, direction, quantity, reason required"),
  quantity: z.union([z.string(), z.number()]),
  reason: z.string().min(1, "variantId, locationId, direction, quantity, reason required"),
  notes: z.string().optional(),
});

export const transferStockSchema = z.object({
  variantId: z.string().min(1, "variantId, fromLocationId, toLocationId, quantity required"),
  fromLocationId: z.string().min(1, "variantId, fromLocationId, toLocationId, quantity required"),
  toLocationId: z.string().min(1, "variantId, fromLocationId, toLocationId, quantity required"),
  quantity: z.union([z.string(), z.number()]),
  notes: z.string().optional(),
});

export const stockTakeSchema = z.object({
  branchId: z.string().min(1, "branchId, locationId, lines required"),
  locationId: z.string().min(1, "branchId, locationId, lines required"),
  notes: z.string().optional(),
  lines: z
    .array(z.object({ variantId: z.string(), countedQty: z.union([z.string(), z.number()]) }))
    .min(1, "branchId, locationId, lines required"),
});

export const reserveStockSchema = z.object({
  variantId: z.string().min(1, "variantId, locationId, quantity required"),
  locationId: z.string().min(1, "variantId, locationId, quantity required"),
  quantity: z.union([z.string(), z.number()]),
  release: z.boolean().optional(),
});

export const createReceiptSchema = z.object({
  branchId: z.string().optional(),
  locationId: z.string().optional(),
  kind: z.string().optional(),
  supplierId: z.string().optional(),
  purchaseId: z.string().optional(),
  purchaseOrderId: z.string().optional(),
  fromLocationId: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.unknown()).optional(),
  post: z.boolean().optional(),
  idempotencyKey: z.string().optional(),
}).passthrough();

export const createDamageSchema = z.object({
  branchId: z.string().optional(),
  locationId: z.string().optional(),
  reason: z.string().optional(),
  description: z.string().optional(),
  attachmentDataUrl: z.string().optional(),
  items: z.array(z.unknown()).optional(),
  submit: z.boolean().optional(),
  idempotencyKey: z.string().optional(),
}).passthrough();

export type AdjustStockBody = z.infer<typeof adjustStockSchema>;
export type TransferStockBody = z.infer<typeof transferStockSchema>;
export type StockTakeBody = z.infer<typeof stockTakeSchema>;
export type ReserveStockBody = z.infer<typeof reserveStockSchema>;
