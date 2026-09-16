import { z } from "zod";

export const reportQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    search: z.string().optional(),
    q: z.string().optional(),
    page: z.coerce.number().optional(),
    limit: z.coerce.number().optional(),
    pageSize: z.coerce.number().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.string().optional(),
    order: z.string().optional(),
  })
  .passthrough();
