import bcrypt from "bcryptjs";
import { enqueueOutbox } from "../outbox/enqueue.js";
import { prisma } from "../../lib/prisma.js";
import { acceptEnum, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";
import { visibleUsersWhere } from "../../lib/scope.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { usersRepository } from "./users.repository.js";
import type { CreateUserInput, UpdateUserInput } from "./users.types.js";

function stripPassword<T extends { passwordHash?: unknown }>(user: T): Omit<T, "passwordHash"> {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

async function ensureTenantOwnerRole(tenantId: string) {
  const existing = await usersRepository.findTenantOwnerRole(tenantId);
  if (existing) return existing;
  const permissions = await usersRepository.listPermissions();
  return usersRepository.createTenantOwnerRole(
    tenantId,
    permissions.map((p) => p.id),
  );
}

async function resolveAssignableRole(tenantId: string, roleKey: string) {
  if (roleKey === "TENANT_OWNER") return ensureTenantOwnerRole(tenantId);
  return usersRepository.resolveScopedRole(tenantId, roleKey);
}

async function shopTenantIdForUser(ctx: RequestContext, userId: string): Promise<string | null> {
  if (ctx.isPlatform) {
    const shop = await usersRepository.shopTenantForUser(userId);
    if (shop) return shop.tenantId;
    const fallback = await usersRepository.anyTenantForUser(userId);
    return fallback?.tenantId ?? null;
  }
  const member = await usersRepository.shopMembership(userId, ctx.tenantId!);
  return member?.tenantId ?? null;
}

async function requireVisibleTenant(ctx: RequestContext, userId: string): Promise<string> {
  const user = await usersRepository.findVisibleUserId(ctx, userId);
  if (!user) throw new AppError("NOT_FOUND", "User not found", 404);
  const tenantId = await shopTenantIdForUser(ctx, userId);
  if (!tenantId) throw new AppError("NOT_FOUND", "User not in tenant", 404);
  return tenantId;
}

function assertRoleAssignable(ctx: RequestContext, roleKey: string | undefined, moveTenantId: string | undefined) {
  if (roleKey === "PLATFORM_SUPER_ADMIN" && !ctx.isPlatform) {
    throw new AppError("FORBIDDEN", "Cannot assign platform role", 403);
  }
  if (roleKey === "TENANT_OWNER" && !ctx.isPlatform) {
    throw new AppError(
      "FORBIDDEN",
      "Only the platform super admin can assign the tenant owner role",
      403,
    );
  }
  if (moveTenantId && !ctx.isPlatform) {
    throw new AppError("FORBIDDEN", "Cannot choose a tenant", 403);
  }
}

export const usersService = {
  async list(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["name", "email", "createdAt", "status"],
      defaultSort: "name",
      defaultOrder: "asc",
    });
    const status = acceptEnum(query.status, ["ACTIVE", "DEACTIVATED"] as const);
    const q = list.search;
    const where = {
      ...visibleUsersWhere(ctx),
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ name: ilike(q) }, { email: ilike(q) }] } : {}),
    };
    const { rows, pagination } = await withPagination(list, {
      find: (skip, take) =>
        usersRepository.listUsers(ctx, where, {
          skip,
          take,
          orderBy: { [list.sortBy]: list.sortOrder },
        }),
      count: () => usersRepository.countUsers(where),
    });
    return { rows, pagination };
  },

  async create(ctx: RequestContext, input: CreateUserInput) {
    const { name, email, password, roleKey, branchIds, tenantId } = input;
    if (!name || !email || !password || !roleKey) {
      throw new AppError("VALIDATION", "Missing fields", 400);
    }
    assertRoleAssignable(ctx, roleKey, tenantId);
    if (roleKey === "TENANT_OWNER" && !tenantId) {
      throw new AppError("VALIDATION", "tenantId is required for a tenant owner", 400);
    }
    const targetTenantId = tenantId ? String(tenantId) : ctx.isPlatform ? null : ctx.tenantId!;
    const target = await usersRepository.findTenantById(targetTenantId);
    if (!target) throw new AppError("NOT_FOUND", "Tenant not found", 404);

    const role = await resolveAssignableRole(targetTenantId, roleKey);
    if (!role) throw new AppError("NOT_FOUND", "Role not found", 404);

    const isOwner = roleKey === "TENANT_OWNER";
    const user = await usersRepository.createUser({
      name,
      email: String(email).toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      tenants: { create: { tenantId: targetTenantId, allBranches: isOwner } },
      roles: { create: { roleId: role.id } },
      branches: {
        create: isOwner ? [] : (branchIds ?? []).map((branchId) => ({ branchId })),
      },
    });

    await usersRepository.audit({
      tenantId: targetTenantId,
      userId: ctx.userId,
      actorUserId: ctx.userId,
      action: "user.create",
      entityType: "User",
      entityId: user.id,
      after: { email: user.email, roleKey, tenantId: targetTenantId },
    });
    await enqueueOutbox(prisma, {
      tenantId: targetTenantId,
      type: "STAFF_CREATED",
      aggregateId: user.id,
      payload: { name: user.name, targetUserId: user.id, entityType: "User", entityId: user.id },
    });
    return stripPassword(user);
  },

  async listRoles(ctx: RequestContext) {
    const roles = ctx.isPlatform
      ? await usersRepository.listRolesForAllTenants()
      : await usersRepository.listRolesForTenant(ctx.tenantId!);
    const visible = roles.filter(
      (r) => (r.key !== "PLATFORM_SUPER_ADMIN" && r.key !== "TENANT_OWNER") || ctx.isPlatform,
    );
    if (ctx.isPlatform && !visible.some((r) => r.key === "TENANT_OWNER")) {
      visible.push({
        id: "tenant-owner",
        tenantId: null,
        key: "TENANT_OWNER",
        name: "Tenant owner",
      } as (typeof visible)[number]);
    }
    return visible;
  },

  async getById(ctx: RequestContext, userId: string) {
    const tenantId = ctx.isPlatform ? (ctx.tenantId ?? "") : await requireVisibleTenant(ctx, userId);
    const user = await usersRepository.findUserDetail(ctx, userId, tenantId);
    if (!user) throw new AppError("NOT_FOUND", "User not found", 404);
    return stripPassword(user);
  },

  async update(ctx: RequestContext, userId: string, input: UpdateUserInput) {
    const currentTenant = ctx.isPlatform ? (ctx.tenantId ?? "") : await requireVisibleTenant(ctx, userId);
    const { name, email, password, roleKey, branchIds, status, tenantId: moveTenantId } = input;
    assertRoleAssignable(ctx, roleKey, moveTenantId);
    if (status && status !== "ACTIVE" && status !== "DEACTIVATED") {
      throw new AppError("VALIDATION", "Invalid status", 400);
    }

    const targetTenantId = moveTenantId && ctx.isPlatform ? String(moveTenantId) : currentTenant;
    if (moveTenantId && ctx.isPlatform) {
      const target = await usersRepository.findTenantById(targetTenantId);
      if (!target) throw new AppError("NOT_FOUND", "Tenant not found", 404);
    }

    if (roleKey && !ctx.isPlatform) {
      const targetRole = await usersRepository.findUserRoleKey(userId);
      if (targetRole?.role.key === "TENANT_OWNER" && targetRole.role.key !== roleKey) {
        throw new AppError("FORBIDDEN", "The tenant owner role cannot be changed", 403);
      }
    }

    if (roleKey === "TENANT_OWNER" && ctx.isPlatform) {
      await usersRepository.setAllBranches(userId, targetTenantId, true);
    }
    if (ctx.isPlatform && targetTenantId !== currentTenant) {
      await usersRepository.moveUserToTenant(userId, targetTenantId, roleKey === "TENANT_OWNER");
    }

    if (roleKey) {
      const role = await resolveAssignableRole(targetTenantId, roleKey);
      if (!role) throw new AppError("NOT_FOUND", "Role not found", 404);
      await usersRepository.replaceUserRole(userId, role.id);
    }
    if (Array.isArray(branchIds)) {
      const ids = branchIds.filter(Boolean);
      const owned = await usersRepository.listBranchesInTenant(targetTenantId, ids);
      await usersRepository.replaceUserBranches(
        userId,
        targetTenantId,
        owned.map((b) => b.id),
      );
    }

    const user = await usersRepository.updateUser(userId, {
      name: name || undefined,
      email: email ? String(email).toLowerCase() : undefined,
      status: status || undefined,
      ...(password ? { passwordHash: await bcrypt.hash(String(password), 10) } : {}),
    });
    const safe = stripPassword(user);

    await usersRepository.audit({
      tenantId: targetTenantId,
      userId: ctx.userId,
      actorUserId: ctx.userId,
      action: "user.update",
      entityType: "User",
      entityId: user.id,
      after: Object.fromEntries(
        [
          ["name", name],
          ["email", email && String(email).toLowerCase()],
          ["roleKey", roleKey],
          ["tenantId", targetTenantId !== currentTenant ? targetTenantId : undefined],
        ].filter(([, v]) => v != null),
      ),
    });
    if (roleKey) {
      await enqueueOutbox(prisma, {
        tenantId: targetTenantId,
        type: "ROLE_CHANGED",
        aggregateId: user.id,
        payload: { name: user.name, targetUserId: user.id, roleKey, entityType: "User", entityId: user.id },
      });
    }
    if (Array.isArray(branchIds)) {
      await enqueueOutbox(prisma, {
        tenantId: targetTenantId,
        type: "BRANCH_CHANGED",
        aggregateId: user.id,
        payload: { name: user.name, targetUserId: user.id, entityType: "User", entityId: user.id },
      });
    }
    if (status === "DEACTIVATED") {
      await enqueueOutbox(prisma, {
        tenantId: targetTenantId,
        type: "STAFF_DEACTIVATED",
        aggregateId: user.id,
        payload: { name: user.name, targetUserId: user.id, entityType: "User", entityId: user.id },
      });
    }
    return safe;
  },

  async deactivate(ctx: RequestContext, userId: string) {
    const tenantId = ctx.isPlatform ? (ctx.tenantId ?? "") : await requireVisibleTenant(ctx, userId);
    const user = await usersRepository.deactivateUser(userId);
    await usersRepository.audit({
      tenantId,
      userId: ctx.userId,
      actorUserId: ctx.userId,
      action: "user.deactivate",
      entityType: "User",
      entityId: user.id,
    });
    await enqueueOutbox(prisma, {
      tenantId,
      type: "STAFF_DEACTIVATED",
      aggregateId: user.id,
      payload: { name: user.name, targetUserId: user.id, entityType: "User", entityId: user.id },
    });
    return stripPassword(user);
  },
};
