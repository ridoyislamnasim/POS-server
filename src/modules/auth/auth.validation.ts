import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().min(1, "Email and password required"),
  password: z.string().min(1, "Email and password required"),
  tenantId: z.string().optional(),
});

export type LoginBody = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  imageUrl: z.string().nullable().optional(),
});

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
