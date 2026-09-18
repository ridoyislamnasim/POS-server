import { prisma } from "../../lib/prisma.js";
import { requireTenantId, visibleUsersWhere } from "../../lib/scope.js";
import type { RequestContext } from "../../types.js";

/**
 * Data-access for users/roles/memberships.
 * Business rules (owner-role bootstrapping, visibility) live in the service;
 * this file only runs Prisma queries.
 */
export const usersRepository = {
  findScopedRole(tenantId: string, roleKey: string) {
    return prisma.role.findFirst({ where: { key: roleKey, tenantId } });
  },

  findGlobalRole(roleKey: string) {
    return prisma.role.findFirst({ where: { key: roleKey, tenantId: null } });
  },

  async resolveScopedRole(tenantId: string | null, roleKey: string) {
    const tenantRole = await prisma.role.findFirst({ where: { key: roleKey, tenantId } });
    if (tenantRole) return tenantRole;
    return prisma.role.findFirst({ where: { key: roleKey, tenantId: null } });
  },

  findTenantOwnerRole(tenantId: string) {
    return prisma.role.findFirst({ where: { key: "TENANT_OWNER", tenantId } });
  },

  listPermissions() {
    return prisma.permission.findMany({ select: { id: true } });
  },

  createTenantOwnerRole(tenantId: string, permissionIds: string[]) {
    return prisma.role.create({
      data: {
        tenantId,
        key: "TENANT_OWNER",
        name: "Tenant owner",
        permissions: { create: permissionIds.map((id) => ({ permissionId: id })) },
      },
    });
  },

findTenantById(id: string | null) {
    if (!id) return null;
    return prisma.tenant.findUnique({ where: { id }, select: { id: true } });
  },

  shopTenantForUser(userId: string) {
    return prisma.userTenant.findFirst({
      where: { userId, isPlatform: false },
      select: { tenantId: true },
    });
  },

  anyTenantForUser(userId: string) {
    return prisma.userTenant.findFirst({ where: { userId }, select: { tenantId: true } });
  },

  shopMembership(userId: string, tenantId: string) {
    return prisma.userTenant.findFirst({
      where: { userId, tenantId, isPlatform: false },
      select: { tenantId: true },
    });
  },

  findVisibleUserId(ctx: RequestContext, userId: string) {
    return prisma.user.findFirst({
      where: { id: userId, ...visibleUsersWhere(ctx) },
      select: { id: true },
    });
  },

  listUsers(ctx: RequestContext, where: Record<string, unknown>, opts: { skip: number; take: number; orderBy: Record<string, unknown> }) {
    const roleWhere = ctx.isPlatform
      ? {}
      : { role: { OR: [{ tenantId: ctx.tenantId! }, { tenantId: null }], key: { not: "PLATFORM_SUPER_ADMIN" } } };
    return prisma.user.findMany({
      where: where as never,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
        roles: {
          where: roleWhere,
          select: { role: { select: { key: true, name: true } } },
        },
        branches: {
          where: ctx.isPlatform ? {} : { branch: { tenantId: ctx.tenantId! } },
          select: { branch: { select: { name: true } } },
        },
        tenants: {
          where: ctx.isPlatform ? {} : { tenantId: ctx.tenantId!, isPlatform: false },
          select: { isPlatform: true, tenant: { select: { id: true, name: true } } },
        },
      },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countUsers(where: Record<string, unknown>) {
    return prisma.user.count({ where: where as never });
  },

  createUser(data: Parameters<typeof prisma.user.create>[0]["data"]) {
    return prisma.user.create({
      data,
      include: { roles: { include: { role: true } }, branches: true },
    });
  },

listRolesForTenant(tenantId: string) {
    return prisma.role.findMany({
      where: { OR: [{ tenantId }, { tenantId: null }] },
    });
  },

  listRolesForAllTenants() {
    return prisma.role.findMany({});
  },

  findUserDetail(ctx: RequestContext, userId: string, tenantId: string) {
    return prisma.user.findFirst({
      where: { id: userId, ...visibleUsersWhere(ctx) },
      include: {
        roles: {
          where: ctx.isPlatform
            ? {}
            : { role: { OR: [{ tenantId }, { tenantId: null }], key: { not: "PLATFORM_SUPER_ADMIN" } } },
          include: { role: true },
        },
        branches: {
          where: ctx.isPlatform ? {} : { branch: { tenantId } },
          include: { branch: true },
        },
        tenants: {
          where: ctx.isPlatform ? {} : { tenantId, isPlatform: false },
          include: { tenant: true },
        },
      },
    });
  },

  updateUser(userId: string, data: Parameters<typeof prisma.user.update>[0]["data"]) {
    return prisma.user.update({
      where: { id: userId },
      data,
      include: { roles: { include: { role: true } }, branches: { include: { branch: true } } },
    });
  },

  deactivateUser(userId: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { status: "DEACTIVATED" },
    });
  },

  findUserRoleKey(userId: string) {
    return prisma.userRole.findFirst({
      where: { userId },
      include: { role: { select: { key: true } } },
    });
  },

  replaceUserRole(userId: string, roleId: string) {
    return prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId } }),
      prisma.userRole.create({ data: { userId, roleId } }),
    ]);
  },

  listBranchesInTenant(tenantId: string, ids: string[]) {
    return prisma.branch.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true },
    });
  },

  replaceUserBranches(userId: string, tenantId: string, branchIds: string[]) {
    return prisma.$transaction(async (tx) => {
      await tx.userBranch.deleteMany({ where: { userId, branch: { tenantId } } });
      if (branchIds.length) {
        await tx.userBranch.createMany({ data: branchIds.map((branchId) => ({ userId, branchId })) });
      }
    });
  },

  moveUserToTenant(userId: string, targetTenantId: string, allBranches: boolean) {
    return prisma.$transaction(async (tx) => {
      await tx.userTenant.deleteMany({ where: { userId, isPlatform: false } });
      await tx.userTenant.create({ data: { userId, tenantId: targetTenantId, allBranches } });
      await tx.userBranch.deleteMany({ where: { userId } });
    });
  },

  setAllBranches(userId: string, tenantId: string, allBranches: boolean) {
    return prisma.userTenant.updateMany({
      where: { userId, tenantId },
      data: { allBranches },
    });
  },

  audit(entry: Parameters<typeof prisma.auditLog.create>[0]["data"]) {
    return prisma.auditLog.create({ data: entry });
  },

  ctxTenant(ctx: RequestContext): string {
    return requireTenantId(ctx);
  },
};
