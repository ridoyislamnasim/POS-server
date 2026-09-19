import { z } from "zod";

export const updateRoleSchema = z.object({
  permissions: z.array(z.string(), { required_error: "permissions array required" }),
});

export const createRoleSchema = z.object({
  name: z.string().min(1, "name required"),
  key: z
    .string()
    .min(1, "key required")
    .regex(/^[A-Z][A-Z0-9_]*$/, "key must be uppercase letters, digits, underscores, starting with a letter"),
  permissions: z.array(z.string()).optional(),
  tenantId: z.string().optional(),
});

export const createAttendanceSchema = z.object({
  userId: z.string().min(1, "userId and branchId required"),
  branchId: z.string().min(1, "userId and branchId required"),
  status: z.string().optional(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  notes: z.string().optional(),
  workDate: z.string().optional(),
});

export const createShiftTemplateSchema = z.object({
  name: z.string().min(1, "name, startTime, endTime required"),
  startTime: z.string().min(1, "name, startTime, endTime required"),
  endTime: z.string().min(1, "name, startTime, endTime required"),
  days: z.array(z.string()).optional(),
});

export type UpdateRoleBody = z.infer<typeof updateRoleSchema>;
export type CreateRoleBody = z.infer<typeof createRoleSchema>;
export type CreateAttendanceBody = z.infer<typeof createAttendanceSchema>;
export type CreateShiftTemplateBody = z.infer<typeof createShiftTemplateSchema>;
