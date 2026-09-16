import { z } from "zod";

export const bootstrapPlatformSchema = z.object({
  name: z.string().trim().min(1, "Name required").max(100),
  email: z.string().trim().min(1, "Email required").max(190).email("Invalid email"),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(128)
    .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Password must include a letter and a number"),
  tenantId: z.string().trim().min(1).max(64).optional(),
});

export type BootstrapPlatformBody = z.infer<typeof bootstrapPlatformSchema>;
