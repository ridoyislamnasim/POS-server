import type { Request } from "express";

export type RequestContext = {
  userId: string;
  tenantId: string | null;
  isPlatform: boolean;
  branchIds: string[];
  allBranches: boolean;
  permissions: string[];
  roles: string[];
  businessDate: string;
};

export type AuthedRequest = Request & {
  ctx: RequestContext;
  requestId: string;
  correlationId: string;
};
