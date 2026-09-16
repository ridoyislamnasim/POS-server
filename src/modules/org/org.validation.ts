import { z } from "zod";

export const updateBusinessSchema = z.object({
  name: z.string().optional(),
  legalName: z.string().optional(),
  vatId: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  logoUrl: z.string().optional(),
  currency: z.string().optional(),
  tenantName: z.string().optional(),
});

export const createBranchSchema = z.object({
  name: z.string().min(1, "name and code required"),
  code: z.string().min(1, "name and code required"),
  type: z.string().optional(),
  timezone: z.string().optional(),
  negativeStockPolicy: z.string().optional(),
});

export const updateBranchSchema = z.object({
  name: z.string().optional(),
  operationalStatus: z.string().optional(),
  timezone: z.string().optional(),
  negativeStockPolicy: z.string().optional(),
});

export const createWarehouseSchema = z.object({
  name: z.string().min(1, "name required"),
});

export const updateWarehouseSchema = z.object({
  name: z.string().min(1).optional(),
});

export type UpdateBusinessBody = z.infer<typeof updateBusinessSchema>;
export type CreateBranchBody = z.infer<typeof createBranchSchema>;
export type UpdateBranchBody = z.infer<typeof updateBranchSchema>;
export type CreateWarehouseBody = z.infer<typeof createWarehouseSchema>;
export type UpdateWarehouseBody = z.infer<typeof updateWarehouseSchema>;
