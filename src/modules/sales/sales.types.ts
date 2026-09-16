import type { createSaleSchema } from "./sales.validation.js";
import type { z } from "zod";

export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export type HoldSaleInput = {
  branchId: string;
  payload?: unknown;
};
