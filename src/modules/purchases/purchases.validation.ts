import { z } from "zod";

const poItem = z.object({
  variantId: z.string(),
  qty: z.number(),
  unitCost: z.number().optional(),
  taxRate: z.number().optional(),
});

const orderItem = z.object({
  variantId: z.string(),
  qty: z.number(),
  unitCost: z.number(),
  taxRate: z.number().optional(),
  retailPrice: z.number().optional(),
  wholesalePrice: z.number().optional(),
  discount: z.number().optional(),
});

export const createOrderSchema = z.object({
  branchId: z.string().min(1, "branchId, supplierId, items required"),
  supplierId: z.string().min(1, "branchId, supplierId, items required"),
  notes: z.string().optional(),
  expectedAt: z.string().optional(),
  items: z.array(poItem).min(1, "branchId, supplierId, items required"),
});

export const receivePurchaseSchema = z.object({
  branchId: z.string().min(1, "branchId, supplierId, items required"),
  locationId: z.string().optional(),
  supplierId: z.string().min(1, "branchId, supplierId, items required"),
  purchaseOrderId: z.string().optional(),
  paid: z.union([z.string(), z.number()]).optional(),
  notes: z.string().optional(),
  items: z.array(orderItem).min(1, "branchId, supplierId, items required"),
});

export const createPurchaseReturnSchema = z.object({
  reason: z.string().min(1, "reason and items required"),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        purchaseItemId: z.string(),
        qty: z.number(),
      }),
    )
    .min(1, "reason and items required"),
});

export type CreateOrderBody = z.infer<typeof createOrderSchema>;
export type ReceivePurchaseBody = z.infer<typeof receivePurchaseSchema>;
export type CreatePurchaseReturnBody = z.infer<typeof createPurchaseReturnSchema>;
