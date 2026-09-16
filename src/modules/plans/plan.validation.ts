import { z } from "zod";

export const createPlanSchema = z.object({
  code: z.string().min(1, "code and name required"),
  name: z.string().min(1, "code and name required"),
  description: z.string().optional(),
  interval: z.enum(["MONTHLY", "YEARLY"]).optional(),
  price: z.number().optional(),
  yearlyPrice: z.number().optional(),
  currency: z.string().optional(),
  displayOrder: z.number().optional(),
});

export const updatePlanSchema = z.object({
  code: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  interval: z.enum(["MONTHLY", "YEARLY"]).optional(),
  price: z.number().optional(),
  yearlyPrice: z.number().optional(),
  currency: z.string().optional(),
  active: z.boolean().optional(),
  displayOrder: z.number().optional(),
});

export const setPlanLimitsSchema = z.object({
  limits: z.array(z.unknown(), { required_error: "limits array required" }),
});

export const setPlanFeaturesSchema = z.object({
  features: z.array(z.unknown(), { required_error: "features array required" }),
});

export type CreatePlanBody = z.infer<typeof createPlanSchema>;
export type UpdatePlanBody = z.infer<typeof updatePlanSchema>;
