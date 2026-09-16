import { z } from "zod";

export const createSupplierSchema = z.object({
  name: z.string().min(1, "name required"),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  taxId: z.string().optional(),
  notes: z.string().optional(),
});

export const updateSupplierSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  taxId: z.string().optional(),
  notes: z.string().optional(),
  status: z.string().optional(),
});

export type CreateSupplierBody = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierBody = z.infer<typeof updateSupplierSchema>;
