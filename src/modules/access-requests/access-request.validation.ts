import { z } from "zod";

export const createAccessRequestSchema = z.object({
  type: z.string().optional(),
  requestedPlanId: z.string().optional(),
  reason: z.string().optional(),
});

export const approveAccessRequestSchema = z.object({
  expiresAt: z.string().optional(),
});

export const rejectAccessRequestSchema = z.object({
  reason: z.string().min(1, "Rejection reason required"),
});

export const createLimitOverrideSchema = z.object({
  tenantId: z.string().min(1, "tenantId, resource, and limitValue required"),
  resource: z.string().min(1, "tenantId, resource, and limitValue required"),
  limitValue: z.union([z.string(), z.number()]),
  expiresAt: z.string().optional(),
  reason: z.string().optional(),
});

export const createFeatureOverrideSchema = z.object({
  tenantId: z.string().min(1, "tenantId and feature required"),
  feature: z.string().min(1, "tenantId and feature required"),
  enabled: z.boolean().optional(),
  expiresAt: z.string().optional(),
  reason: z.string().optional(),
});

export const revokeOverrideSchema = z.object({
  type: z.enum(["limit", "feature"]),
});

export type CreateAccessRequestBody = z.infer<typeof createAccessRequestSchema>;
