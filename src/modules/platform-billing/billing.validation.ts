import { z } from "zod";

export const createBillingTenantSchema = z.object({}).passthrough();

export const updateBillingTenantSchema = z.object({}).passthrough();

export const setApiAccessSchema = z.object({
  enabled: z.boolean().optional(),
  reason: z.string().optional(),
});

export const createPlatformInvoiceSchema = z.object({}).passthrough();

export const updatePlatformInvoiceSchema = z.object({}).passthrough();

export const setInvoiceStatusSchema = z.object({}).passthrough();
