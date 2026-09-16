import { z } from "zod";

export const createSalesOrderSchema = z.object({
  branchId: z.string().min(1, "branchId and items required"),
  customerId: z.string().optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        variantId: z.string(),
        qty: z.number(),
        unitPrice: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .min(1, "branchId and items required"),
});

export const updateSalesOrderSchema = z.object({
  status: z.string().optional(),
  notes: z.string().optional(),
});

export const createEcommerceOrderSchema = z.object({
  channel: z.string().min(1, "channel, externalId, total required"),
  externalId: z.union([z.string(), z.number()]),
  customerId: z.string().optional(),
  total: z.union([z.string(), z.number()]),
  payload: z.unknown().optional(),
  status: z.string().optional(),
});

export const createDeliverySchema = z.object({
  branchId: z.string().min(1, "branchId and address required"),
  salesOrderId: z.string().optional(),
  saleId: z.string().optional(),
  address: z.string().min(1, "branchId and address required"),
  phone: z.string().optional(),
  courier: z.string().optional(),
  tracking: z.string().optional(),
  scheduledAt: z.string().optional(),
  notes: z.string().optional(),
});

export const updateDeliverySchema = z.object({
  status: z.string().optional(),
  courier: z.string().optional(),
  tracking: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateSalesOrderBody = z.infer<typeof createSalesOrderSchema>;
export type UpdateSalesOrderBody = z.infer<typeof updateSalesOrderSchema>;
export type CreateEcommerceOrderBody = z.infer<typeof createEcommerceOrderSchema>;
export type CreateDeliveryBody = z.infer<typeof createDeliverySchema>;
export type UpdateDeliveryBody = z.infer<typeof updateDeliverySchema>;
