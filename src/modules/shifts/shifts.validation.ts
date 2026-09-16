import { z } from "zod";

export const openShiftSchema = z.object({
  branchId: z.string().min(1, "branchId and registerId are required"),
  registerId: z.string().min(1, "branchId and registerId are required"),
  openingFloat: z.union([z.string(), z.number()]).optional(),
});

export const closeShiftSchema = z.object({
  closingCash: z.union([z.string(), z.number()]).optional(),
});

export type OpenShiftBody = z.infer<typeof openShiftSchema>;
export type CloseShiftBody = z.infer<typeof closeShiftSchema>;
