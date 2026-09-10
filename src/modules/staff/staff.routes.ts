import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok, okList } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { Permissions } from "../../shared/permissions.js";
import { tenantId } from "../../lib/erp.js";
import { writeAudit } from "../../lib/audit.js";
import { assertBranch, visibleMembershipWhere, visibleUsersWhere } from "../../lib/scope.js";
import type { AuthedRequest } from "../../types.js";
import { acceptEnum, acceptId, dateRange, ilike, parseListQuery, paginationMeta, withPagination } from "../../lib/list-query.js";

export const staffRouter = Router();
staffRouter.use(requireAuth, requireTenant);

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

staffRouter.get("/permissions", requirePermission("user.manage"), async (_req, res) => {
  return ok(res, [...Permissions]);
});

staffRouter.get("/roles", requirePermission("user.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["name", "key"], defaultSort: "name", defaultOrder: "asc" });
  const q = list.search.toLowerCase();
  const roles = await prisma.role.findMany({
    where: { OR: [{ tenantId: tenantId(ctx) }, { tenantId: null }] },
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
  });
  const mapped = roles
    .filter((r) => r.key !== "PLATFORM_SUPER_ADMIN" || ctx.isPlatform)
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q))
    .map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      tenantId: r.tenantId,
      users: r._count.users,
      permissions: r.permissions.map((p) => p.permission.key),
    }));
  const rows = mapped.slice(list.skip, list.skip + list.take);
  return okList(res, rows, paginationMeta(mapped.length, list.page, list.limit));
});

staffRouter.patch("/roles/:id", requirePermission("user.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const role = await prisma.role.findFirst({
    where: { id: String(req.params.id), OR: [{ tenantId: tenantId(ctx) }, { tenantId: null }] },
  });
  if (!role) return fail(res, "NOT_FOUND", "Role not found", 404);
  if (role.tenantId == null && !ctx.isPlatform) return fail(res, "FORBIDDEN", "Cannot edit platform role", 403);
  const keys = Array.isArray(req.body?.permissions) ? (req.body.permissions as string[]) : null;
  if (!keys) return fail(res, "VALIDATION", "permissions array required");
  const allowed = new Set<string>(Permissions);
  const perms = await prisma.permission.findMany({ where: { key: { in: keys.filter((k) => allowed.has(k)) } } });
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
    prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    }),
  ]);
  await writeAudit({ ctx, action: "role.update", entityType: "Role", entityId: role.id, after: { keys } });
  return ok(res, { id: role.id, permissions: perms.map((p) => p.key) });
});

staffRouter.get("/attendance", requirePermission("staff.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["workDate", "createdAt", "status"], defaultSort: "workDate", defaultOrder: "desc" });
  const status = acceptEnum(req.query.status, ["PRESENT", "ABSENT", "LATE", "LEAVE", "HALF_DAY"] as const);
  const userId = acceptId(req.query.userId);
  const dates = dateRange(list.dateFrom, list.dateTo);
  const q = list.search;
  const where = {
    tenantId: tenantId(ctx),
    ...(status ? { status } : {}),
    ...(userId ? { userId } : {}),
    ...(dates ? { workDate: dates } : {}),
    ...(q ? { user: { OR: [{ name: ilike(q) }, { email: ilike(q) }] } } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.attendance.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } }, branch: { select: { name: true } } },
        orderBy: list.sortBy === "status" ? { status: list.sortOrder } : { workDate: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.attendance.count({ where }),
  });
  return okList(res, rows, pagination);
});

staffRouter.post("/attendance", requirePermission("attendance.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { userId, branchId, status, checkIn, checkOut, notes, workDate } = req.body ?? {};
  if (!userId || !branchId) return fail(res, "VALIDATION", "userId and branchId required");
  assertBranch(ctx, branchId);
  const member = await prisma.user.findFirst({
    where: { id: String(userId), ...visibleUsersWhere(ctx) },
    select: { id: true },
  });
  if (!member) return fail(res, "NOT_FOUND", "User not in tenant", 404);
  const row = await prisma.attendance.create({
    data: {
      tenantId: tenantId(ctx),
      userId,
      branchId,
      status: status ?? "PRESENT",
      checkIn: checkIn ? new Date(checkIn) : new Date(),
      checkOut: checkOut ? new Date(checkOut) : null,
      notes,
      workDate: new Date(workDate || ctx.businessDate),
    },
    include: { user: { select: { name: true } }, branch: { select: { name: true } } },
  });
  return ok(res, row, undefined, 201);
});

staffRouter.delete("/attendance/:id", requirePermission("attendance.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.attendance.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Attendance not found", 404);
  await prisma.attendance.delete({ where: { id: existing.id } });
  return ok(res, { id: existing.id });
});

staffRouter.get("/shift-templates", requirePermission("shift.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const rows = await prisma.shiftTemplate.findMany({ where: { tenantId: tenantId(ctx) }, orderBy: { name: "asc" } });
  return ok(res, rows);
});

staffRouter.post("/shift-templates", requirePermission("shift.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { name, startTime, endTime, days } = req.body ?? {};
  if (!name || !startTime || !endTime) return fail(res, "VALIDATION", "name, startTime, endTime required");
  const row = await prisma.shiftTemplate.create({
    data: {
      tenantId: tenantId(ctx),
      name,
      startTime,
      endTime,
      days: days ?? ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
    },
  });
  return ok(res, row, undefined, 201);
});

staffRouter.get("/security/logins", requirePermission("user.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt"], defaultSort: "createdAt", defaultOrder: "desc" });
  const members = await prisma.user.findMany({
    where: visibleUsersWhere(ctx),
    select: { email: true },
  });
  const emails = members.map((m) => m.email);
  const q = list.search;
  const where = {
    email: emails.length ? { in: emails } : "__none__",
    ...(q ? { email: { contains: q, mode: "insensitive" as const } } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.loginAttempt.findMany({
        where: emails.length
          ? { email: { in: emails, ...(q ? { contains: q, mode: "insensitive" as const } : {}) } }
          : { email: "__none__" },
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: { id: true, email: true, success: true, ip: true, createdAt: true },
      }),
    count: () =>
      prisma.loginAttempt.count({
        where: emails.length ? { email: { in: emails } } : { email: "__none__" },
      }),
  });
  return okList(res, rows, pagination);
});

staffRouter.get("/security/sessions", requirePermission("user.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt"], defaultSort: "createdAt", defaultOrder: "desc" });
  const memberIds = await prisma.userTenant.findMany({
    where: visibleMembershipWhere(ctx),
    select: { userId: true },
    distinct: ["userId"],
  });
  const ids = memberIds.map((m) => m.userId);
  const q = list.search;
  const where = {
    userId: { in: ids },
    ...(q ? { user: { OR: [{ name: ilike(q) }, { email: ilike(q) }] } } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.session.findMany({
        where,
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          revokedAt: true,
          userAgent: true,
          ip: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    count: () => prisma.session.count({ where }),
  });
  return okList(res, rows, pagination);
});

staffRouter.post("/security/sessions/:id/revoke", requirePermission("user.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const memberIds = await prisma.userTenant.findMany({
    where: visibleMembershipWhere(ctx),
    select: { userId: true },
    distinct: ["userId"],
  });
  const existing = await prisma.session.findFirst({
    where: { id: String(req.params.id), userId: { in: memberIds.map((m) => m.userId) } },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Session not found", 404);
  const row = await prisma.session.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });
  return ok(res, row);
});
