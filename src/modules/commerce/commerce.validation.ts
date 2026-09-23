import { z } from "zod";

const itemSchema = z.object({
  variantId: z.string().min(1),
  qty: z.number().positive("qty must be > 0").or(z.string().transform((v) => Number(v))).refine((v) => Number(v) > 0, { message: "qty must be > 0" }),
  unitPrice: z.union([z.string(), z.number()]).optional(),
  originalPrice: z.union([z.string(), z.number()]).optional(),
  discountAmount: z.union([z.string(), z.number()]).optional(),
  discountPercent: z.union([z.string(), z.number()]).optional(),
  discountReason: z.string().optional(),
  taxRate: z.union([z.string(), z.number()]).optional(),
});

export const createSalesOrderSchema = z.object({
  branchId: z.string().min(1, "branchId required"),
  locationId: z.string().optional(),
  customerId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  customerNotes: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  deliveryNotes: z.string().optional().nullable(),
  expectedDeliveryAt: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  discount: z.union([z.string(), z.number()]).optional(),
  tax: z.union([z.string(), z.number()]).optional(),
  status: z.enum(["DRAFT", "CONFIRMED"]).optional(),
  items: z.array(itemSchema).min(1, "at least one item required"),
});

export const updateSalesOrderSchema = z.object({
  status: z.string().optional(),
  notes: z.string().optional().nullable(),
  customerNotes: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  deliveryNotes: z.string().optional().nullable(),
  expectedDeliveryAt: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  branchId: z.string().optional(),
  customerId: z.string().optional().nullable(),
  items: z.array(itemSchema).optional(),
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
