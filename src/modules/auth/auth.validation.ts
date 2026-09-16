import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().min(1, "Email and password required"),
  password: z.string().min(1, "Email and password required"),
  tenantId: z.string().optional(),
});

export type LoginBody = z.infer<typeof loginSchema>;
