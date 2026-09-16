import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().min(1, "Missing fields"),
  email: z.string().min(1, "Missing fields"),
  password: z.string().min(1, "Missing fields"),
  roleKey: z.string().min(1, "Missing fields"),
  branchIds: z.array(z.string()).optional(),
  tenantId: z.string().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  roleKey: z.string().min(1).optional(),
  branchIds: z.array(z.string()).optional(),
  status: z.enum(["ACTIVE", "DEACTIVATED"]).optional(),
  tenantId: z.string().optional(),
});

export const listUsersSchema = z.object({
  status: z.enum(["ACTIVE", "DEACTIVATED"]).optional(),
  search: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.string().optional(),
  order: z.string().optional(),
}).passthrough();

export type CreateUserBody = z.infer<typeof createUserSchema>;
export type UpdateUserBody = z.infer<typeof updateUserSchema>;
