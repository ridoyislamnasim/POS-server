import { z } from "zod";

export const createCustomerSchema = z.object({
  name: z.string().optional(),
  phone: z.string().min(1, "phone required"),
  email: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  taxId: z.string().optional(),
  creditLimit: z.union([z.string(), z.number()]).optional(),
  type: z.string().optional(),
  createOnly: z.boolean().optional(),
});

export const updateCustomerSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  taxId: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  creditLimit: z.union([z.string(), z.number()]).optional(),
  birthday: z.string().optional(),
});

export const adjustLoyaltySchema = z.object({
  type: z.string().min(1, "type and points required"),
  points: z.union([z.string(), z.number()]),
  notes: z.string().optional(),
});

export type CreateCustomerBody = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerBody = z.infer<typeof updateCustomerSchema>;
export type AdjustLoyaltyBody = z.infer<typeof adjustLoyaltySchema>;
