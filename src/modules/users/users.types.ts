export type CreateUserInput = {
  name: string;
  email: string;
  password: string;
  roleKey: string;
  branchIds?: string[];
  tenantId?: string;
};

export type UpdateUserInput = {
  name?: string;
  email?: string;
  password?: string;
  roleKey?: string;
  branchIds?: string[];
  status?: "ACTIVE" | "DEACTIVATED";
  tenantId?: string;
};

export type ListUsersQuery = {
  status?: "ACTIVE" | "DEACTIVATED";
  search?: string;
  page?: unknown;
  limit?: unknown;
  sortBy?: string;
  sortOrder?: unknown;
};
