import type { RequestContext } from "../types.js";

export class ForbiddenError extends Error {
  code = "FORBIDDEN";
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class InsufficientStockError extends Error {
  code = "INSUFFICIENT_STOCK";
  constructor(message = "Insufficient stock") {
    super(message);
    this.name = "InsufficientStockError";
  }
}

export function requireTenantId(ctx: RequestContext): string {
  if (!ctx.tenantId) throw new ForbiddenError("Tenant required");
  return ctx.tenantId;
}

export function branchWhere(ctx: RequestContext): { branchId?: { in: string[] } } {
  if (ctx.allBranches || ctx.isPlatform) return {};
  return { branchId: { in: ctx.branchIds } };
}

export function canAccessBranch(ctx: RequestContext, branchId: string): boolean {
  if (!branchId || branchId === "null" || branchId === "undefined") return false;
  if (ctx.isPlatform || ctx.allBranches) return true;
  return ctx.branchIds.includes(branchId);
}

export function assertBranch(ctx: RequestContext, branchId: string) {
  if (!canAccessBranch(ctx, branchId)) throw new ForbiddenError("Branch not allowed");
}

export function hasPermission(ctx: RequestContext, key: string) {
  if (ctx.isPlatform || ctx.roles.includes("TENANT_OWNER")) return true;
  return ctx.permissions.includes(key);
}
