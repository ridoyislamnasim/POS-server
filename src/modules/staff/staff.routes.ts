import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { Permissions } from "../../shared/permissions.js";
import { tenantId } from "../../lib/erp.js";
import { writeAudit } from "../../lib/audit.js";
import { assertBranch } from "../../lib/scope.js";
import type { AuthedRequest } from "../../types.js";

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
  const roles = await prisma.role.findMany({
    where: { OR: [{ tenantId: tenantId(ctx) }, { tenantId: null }] },
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
  });
  return ok(
    res,
    roles
      .filter((r) => r.key !== "PLATFORM_SUPER_ADMIN" || ctx.isPlatform)
      .map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        tenantId: r.tenantId,
        users: r._count.users,
        permissions: r.permissions.map((p) => p.permission.key),
      })),
  );
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
  const from = req.query.from ? String(req.query.from) : undefined;
  const rows = await prisma.attendance.findMany({
    where: {
      tenantId: tenantId(ctx),
      ...(from ? { workDate: { gte: new Date(from) } } : {}),
    },
    include: { user: { select: { id: true, name: true, email: true } }, branch: { select: { name: true } } },
    orderBy: { workDate: "desc" },
    take: 200,
  });
  return ok(res, rows);
});

staffRouter.post("/attendance", requirePermission("attendance.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { userId, branchId, status, checkIn, checkOut, notes, workDate } = req.body ?? {};
  if (!userId || !branchId) return fail(res, "VALIDATION", "userId and branchId required");
  assertBranch(ctx, branchId);
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
  const rows = await prisma.loginAttempt.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return ok(res, rows);
});

staffRouter.get("/security/sessions", requirePermission("user.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const memberIds = await prisma.userTenant.findMany({
    where: { tenantId: tenantId(ctx) },
    select: { userId: true },
  });
  const rows = await prisma.session.findMany({
    where: { userId: { in: memberIds.map((m) => m.userId) } },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return ok(res, rows);
});

staffRouter.post("/security/sessions/:id/revoke", requirePermission("user.manage"), async (req, res) => {
  const row = await prisma.session.update({
    where: { id: String(req.params.id) },
    data: { revokedAt: new Date() },
  });
  return ok(res, row);
});
