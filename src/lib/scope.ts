import type { Prisma } from "@prisma/client";
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

/** Platform super admin may read every tenant. Everyone else is locked to theirs. */
export function tenantFilter(ctx: RequestContext): { tenantId: string } | Record<string, never> {
  if (ctx.isPlatform) return {};
  return { tenantId: requireTenantId(ctx) };
}

export function canAccessTenant(ctx: RequestContext, recordTenantId: string | null | undefined): boolean {
  if (!recordTenantId) return false;
  if (ctx.isPlatform) return true;
  return ctx.tenantId === recordTenantId;
}

export function assertTenant(ctx: RequestContext, recordTenantId: string | null | undefined) {
  if (!canAccessTenant(ctx, recordTenantId)) throw new ForbiddenError();
}

/**
 * Users a caller may list or manage.
 * Platform: every account. Tenant staff: shop members only — never platform admins or other tenants.
 */
export function visibleUsersWhere(ctx: RequestContext): Prisma.UserWhereInput {
  if (ctx.isPlatform) return {};
  const tenantId = requireTenantId(ctx);
  return {
    AND: [
      { tenants: { some: { tenantId, isPlatform: false } } },
      { roles: { none: { role: { key: "PLATFORM_SUPER_ADMIN" } } } },
    ],
  };
}

export function visibleMembershipWhere(ctx: RequestContext): Prisma.UserTenantWhereInput {
  if (ctx.isPlatform) return {};
  return { tenantId: requireTenantId(ctx), isPlatform: false };
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
