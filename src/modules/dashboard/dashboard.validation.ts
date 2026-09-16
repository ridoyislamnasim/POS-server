import { z } from "zod";

export const dashboardQuerySchema = z
  .object({
    period: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    branchId: z.string().optional(),
  })
  .passthrough();
