import { z } from "zod";

export const documentParamsSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
});

export const documentQuerySchema = z
  .object({
    layout: z.string().optional(),
    kind: z.string().optional(),
    autoprint: z.string().optional(),
  })
  .passthrough();
