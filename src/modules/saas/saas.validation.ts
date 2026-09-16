import { z } from "zod";

export const changePlanSchema = z.object({
  planId: z.string().min(1),
});

export const createApiKeySchema = z.object({
  name: z.string().min(1, "name required"),
});

export const createBackupSchema = z.object({
  note: z.string().optional(),
});

export type ChangePlanBody = z.infer<typeof changePlanSchema>;
export type CreateApiKeyBody = z.infer<typeof createApiKeySchema>;
export type CreateBackupBody = z.infer<typeof createBackupSchema>;
