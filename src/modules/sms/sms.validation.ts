import { z } from "zod";

export const updateSmsSettingsSchema = z.object({}).passthrough();

export const updateSmsTemplateSchema = z.object({}).passthrough();

export const previewSmsSchema = z.object({}).passthrough();

export const sendSmsSchema = z.object({
  to: z.string().optional(),
  phone: z.string().optional(),
  message: z.string().optional(),
  body: z.string().optional(),
}).passthrough();

export const setPlatformAccessSchema = z.object({
  tenantId: z.string().optional(),
  enabled: z.boolean().optional(),
  reason: z.string().nullable().optional(),
}).passthrough();
