import type { RequestContext } from "../../types.js";

export type LoginInput = {
  email: string;
  password: string;
  tenantId?: string;
};

export type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

export type SessionTokens = {
  accessToken: string;
  csrf: string;
};

export type AuthUserView = {
  id: string;
  name: string;
  email: string;
  locale: string;
  roles: string[];
  tenant: unknown;
  branches: unknown[];
  allBranches: boolean;
  isPlatform: boolean;
};

export type ProfileView = {
  id: string;
  name: string;
  email: string;
  locale: string;
  imageUrl: string | null;
};

export type UpdateProfileInput = {
  name?: string;
  imageUrl?: string | null;
};

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};

export type UpdateProfileBody = {
  name?: string;
  imageUrl?: string | null;
};

export type ChangePasswordBody = {
  currentPassword: string;
  newPassword: string;
};

export type Ctx = RequestContext;
