import { z } from "zod";

export const updateSettingsSchema = z.object({}).passthrough();

export const createTaxSchema = z.object({
  name: z.string().min(1, "name and rate required"),
  rate: z.union([z.string(), z.number()]),
});

export const createTemplateSchema = z.object({
  name: z.string().min(1, "name, kind, body required"),
  kind: z.string().min(1, "name, kind, body required"),
  body: z.string().min(1, "name, kind, body required"),
  isDefault: z.boolean().optional(),
});

export const createCurrencySchema = z.object({
  code: z.string().min(1, "code and name required"),
  name: z.string().min(1, "code and name required"),
  minorUnits: z.number().optional(),
});

export type UpdateSettingsBody = z.infer<typeof updateSettingsSchema>;
export type CreateTaxBody = z.infer<typeof createTaxSchema>;
export type CreateTemplateBody = z.infer<typeof createTemplateSchema>;
export type CreateCurrencyBody = z.infer<typeof createCurrencySchema>;
