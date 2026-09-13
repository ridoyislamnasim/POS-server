import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { fail, ok, okList } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import type { AuthedRequest, RequestContext } from "../../types.js";
import { acceptEnum, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";
import { enqueueOutbox } from "../outbox/enqueue.js";
import { requireTenantId, visibleUsersWhere } from "../../lib/scope.js";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireTenant);

async function resolveScopedRole(tenantId: string, roleKey: string) {
  const tenantRole = await prisma.role.findFirst({ where: { key: roleKey, tenantId } });
  if (tenantRole) return tenantRole;
  return prisma.role.findFirst({ where: { key: roleKey, tenantId: null } });
}

/** Tenant owners always get a tenant-scoped role holding every permission. */
async function ensureTenantOwnerRole(tenantId: string) {
  const existing = await prisma.role.findFirst({ where: { key: "TENANT_OWNER", tenantId } });
  if (existing) return existing;
  const permissions = await prisma.permission.findMany({ select: { id: true } });
  return prisma.role.create({
    data: {
      tenantId,
      key: "TENANT_OWNER",
      name: "Tenant owner",
      permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
    },
  });
}

async function resolveAssignableRole(tenantId: string, roleKey: string) {
  if (roleKey === "TENANT_OWNER") return ensureTenantOwnerRole(tenantId);
  return resolveScopedRole(tenantId, roleKey);
}

/** Shop tenant for this user. Tenant staff never resolve platform-only memberships. */
async function shopTenantIdForUser(ctx: RequestContext, userId: string): Promise<string | null> {
  if (ctx.isPlatform) {
    const shop = await prisma.userTenant.findFirst({
      where: { userId, isPlatform: false },
      select: { tenantId: true },
    });
    if (shop) return shop.tenantId;
    const any = await prisma.userTenant.findFirst({ where: { userId }, select: { tenantId: true } });
    return any?.tenantId ?? null;
  }
  const member = await prisma.userTenant.findFirst({
    where: { userId, tenantId: requireTenantId(ctx), isPlatform: false },
    select: { tenantId: true },
  });
  return member?.tenantId ?? null;
}

async function requireVisibleUser(ctx: RequestContext, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, ...visibleUsersWhere(ctx) },
    select: { id: true },
  });
  if (!user) return null;
  return shopTenantIdForUser(ctx, userId);
}

usersRouter.get("/", requirePermission("user.manage"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const list = parseListQuery(req.query, { sortable: ["name", "email", "createdAt", "status"], defaultSort: "name", defaultOrder: "asc" });
  const status = acceptEnum(req.query.status, ["ACTIVE", "DEACTIVATED"] as const);
  const q = list.search;
  const where = {
    ...visibleUsersWhere(ctx),
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ name: ilike(q) }, { email: ilike(q) }] } : {}),
  };
  const roleWhere = ctx.isPlatform
    ? {}
    : { role: { OR: [{ tenantId: ctx.tenantId! }, { tenantId: null }], key: { not: "PLATFORM_SUPER_ADMIN" } } };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.user.findMany({
        where,
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
        orderBy: { [list.sortBy]: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.user.count({ where }),
  });
  return okList(res, rows, pagination);
});

usersRouter.post("/", requirePermission("user.create"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const { name, email, password, roleKey, branchIds, tenantId } = req.body ?? {};
  if (!name || !email || !password || !roleKey) return fail(res, "VALIDATION", "Missing fields");
  if (roleKey === "PLATFORM_SUPER_ADMIN" && !ctx.isPlatform) {
    return fail(res, "FORBIDDEN", "Cannot assign platform role", 403);
  }
  if (roleKey === "TENANT_OWNER" && !ctx.isPlatform) {
    return fail(res, "FORBIDDEN", "Only the platform super admin can assign the tenant owner role", 403);
  }
  if (tenantId && !ctx.isPlatform) {
    return fail(res, "FORBIDDEN", "Cannot choose a tenant", 403);
  }
  if (roleKey === "TENANT_OWNER" && !tenantId) {
    return fail(res, "VALIDATION", "tenantId is required for a tenant owner");
  }

  const targetTenantId = tenantId && ctx.isPlatform ? String(tenantId) : ctx.tenantId!;
  const target = await prisma.tenant.findUnique({ where: { id: targetTenantId }, select: { id: true } });
  if (!target) return fail(res, "NOT_FOUND", "Tenant not found", 404);

  const role = await resolveAssignableRole(targetTenantId, roleKey);
  if (!role) return fail(res, "NOT_FOUND", "Role not found", 404);

  const isOwner = roleKey === "TENANT_OWNER";
  const user = await prisma.user.create({
    data: {
      name,
      email: String(email).toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      tenants: { create: { tenantId: targetTenantId, allBranches: isOwner } },
      roles: { create: { roleId: role.id } },
      branches: {
        create: isOwner ? [] : (branchIds as string[] | undefined)?.map((branchId) => ({ branchId })) ?? [],
      },
    },
    include: { roles: { include: { role: true } }, branches: true },
  });
  const { passwordHash: _, ...safe } = user;
  await prisma.auditLog.create({
    data: {
      tenantId: targetTenantId,
      userId: ctx.userId,
      actorUserId: ctx.userId,
      action: "user.create",
      entityType: "User",
      entityId: user.id,
      after: { email: user.email, roleKey, tenantId: targetTenantId },
    },
  });
  await enqueueOutbox(prisma, {
    tenantId: targetTenantId,
    type: "STAFF_CREATED",
    aggregateId: user.id,
    payload: { name: user.name, targetUserId: user.id, entityType: "User", entityId: user.id },
  });
  return ok(res, safe, undefined, 201);
});

usersRouter.get("/roles", requirePermission("user.manage"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const roles = await prisma.role.findMany({
    where: { OR: [{ tenantId: ctx.tenantId! }, { tenantId: null }] },
  });
  const visible = roles.filter(
    (r) => (r.key !== "PLATFORM_SUPER_ADMIN" && r.key !== "TENANT_OWNER") || ctx.isPlatform,
  );
  if (ctx.isPlatform && !visible.some((r) => r.key === "TENANT_OWNER")) {
    visible.push({ id: "tenant-owner", tenantId: ctx.tenantId!, key: "TENANT_OWNER", name: "Tenant owner" });
  }
  return ok(res, visible);
});

usersRouter.get("/:id", requirePermission("user.manage"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const userId = String(req.params.id);
  const tenantId = await requireVisibleUser(ctx, userId);
  if (!tenantId) return fail(res, "NOT_FOUND", "User not in tenant", 404);
  const user = await prisma.user.findFirst({
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
  if (!user) return fail(res, "NOT_FOUND", "User not found", 404);
  const { passwordHash: _, ...safe } = user;
  return ok(res, safe);
});

usersRouter.patch("/:id", requirePermission("user.manage"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const userId = String(req.params.id);
  const currentTenant = await requireVisibleUser(ctx, userId);
  if (!currentTenant) return fail(res, "NOT_FOUND", "User not in tenant", 404);
  const { name, email, password, roleKey, branchIds, status, tenantId: moveTenantId } = req.body ?? {};
  if (roleKey === "PLATFORM_SUPER_ADMIN" && !ctx.isPlatform) {
    return fail(res, "FORBIDDEN", "Cannot assign platform role", 403);
  }
  if (roleKey === "TENANT_OWNER" && !ctx.isPlatform) {
    return fail(res, "FORBIDDEN", "Only the platform super admin can assign the tenant owner role", 403);
  }
  if (moveTenantId && !ctx.isPlatform) {
    return fail(res, "FORBIDDEN", "Cannot choose a tenant", 403);
  }
  if (status && status !== "ACTIVE" && status !== "DEACTIVATED") {
    return fail(res, "VALIDATION", "Invalid status");
  }

  const targetTenantId = moveTenantId && ctx.isPlatform ? String(moveTenantId) : currentTenant;
  if (moveTenantId && ctx.isPlatform) {
    const target = await prisma.tenant.findUnique({ where: { id: targetTenantId }, select: { id: true } });
    if (!target) return fail(res, "NOT_FOUND", "Tenant not found", 404);
  }

  if (roleKey && !ctx.isPlatform) {
    const targetRole = await prisma.userRole.findFirst({
      where: { userId },
      include: { role: { select: { key: true } } },
    });
    if (targetRole?.role.key === "TENANT_OWNER" && targetRole.role.key !== roleKey) {
      return fail(res, "FORBIDDEN", "The tenant owner role cannot be changed", 403);
    }
  }

  if (roleKey === "TENANT_OWNER" && ctx.isPlatform) {
    await prisma.userTenant.updateMany({
      where: { userId, tenantId: targetTenantId },
      data: { allBranches: true },
    });
  }
  if (ctx.isPlatform && targetTenantId !== currentTenant) {
    await prisma.userTenant.deleteMany({ where: { userId, isPlatform: false } });
    await prisma.userTenant.create({
      data: { userId, tenantId: targetTenantId, allBranches: roleKey === "TENANT_OWNER" },
    });
    await prisma.userBranch.deleteMany({ where: { userId } });
  }

  if (roleKey) {
    const role = await resolveAssignableRole(targetTenantId, roleKey);
    if (!role) return fail(res, "NOT_FOUND", "Role not found", 404);
    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.userRole.create({ data: { userId, roleId: role.id } });
  }
  if (Array.isArray(branchIds)) {
    const ids = (branchIds as string[]).filter(Boolean);
    const owned = await prisma.branch.findMany({
      where: { tenantId: targetTenantId, id: { in: ids } },
      select: { id: true },
    });
    await prisma.userBranch.deleteMany({
      where: { userId, branch: { tenantId: targetTenantId } },
    });
    if (owned.length) {
      await prisma.userBranch.createMany({ data: owned.map((b) => ({ userId, branchId: b.id })) });
    }
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      name: name || undefined,
      email: email ? String(email).toLowerCase() : undefined,
      status: status || undefined,
      ...(password ? { passwordHash: await bcrypt.hash(String(password), 10) } : {}),
    },
    include: { roles: { include: { role: true } }, branches: { include: { branch: true } } },
  });
  const { passwordHash: _, ...safe } = user;
  await prisma.auditLog.create({
    data: {
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
    },
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
  return ok(res, safe);
});

usersRouter.post("/:id/deactivate", requirePermission("user.manage"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const tenantId = await requireVisibleUser(ctx, String(req.params.id));
  if (!tenantId) return fail(res, "NOT_FOUND", "User not in tenant", 404);
  const user = await prisma.user.update({
    where: { id: String(req.params.id) },
    data: { status: "DEACTIVATED" },
  });
  const { passwordHash: _, ...safe } = user;
  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: ctx.userId,
      actorUserId: ctx.userId,
      action: "user.deactivate",
      entityType: "User",
      entityId: user.id,
    },
  });
  await enqueueOutbox(prisma, {
    tenantId,
    type: "STAFF_DEACTIVATED",
    aggregateId: user.id,
    payload: { name: user.name, targetUserId: user.id, entityType: "User", entityId: user.id },
  });
  return ok(res, safe);
});
