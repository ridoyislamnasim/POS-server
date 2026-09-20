import { z } from "zod";

export const changePlanSchema = z.object({
  planId: z.string().min(1),
});

export const createApiKeySchema = z.object({
  name: z.string().min(1, "name required"),
});

const tenantIdSchema = z.string().min(1, "tenantId required").max(64);

export const createBackupSchema = z.object({
  note: z.string().optional(),
  tenantId: tenantIdSchema.optional(),
});

export const listBackupsSchema = z.object({
  tenantId: tenantIdSchema.optional(),
});

export type ChangePlanBody = z.infer<typeof changePlanSchema>;
export type CreateApiKeyBody = z.infer<typeof createApiKeySchema>;
export type CreateBackupBody = z.infer<typeof createBackupSchema>;
