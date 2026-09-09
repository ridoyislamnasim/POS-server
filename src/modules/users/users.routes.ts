import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import type { AuthedRequest } from "../../types.js";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireTenant);

usersRouter.get("/", requirePermission("user.manage"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const q = String(req.query.q ?? "").trim();
  const users = await prisma.user.findMany({
    where: {
      tenants: { some: { tenantId: ctx.tenantId! } },
      ...(q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }
        : {}),
    },
    include: { roles: { include: { role: true } }, branches: { include: { branch: true } } },
    take: 100,
  });
  return ok(res, users.map(({ passwordHash: _, ...u }) => u));
});

usersRouter.post("/", requirePermission("user.create"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const { name, email, password, roleKey, branchIds } = req.body ?? {};
  if (!name || !email || !password || !roleKey) return fail(res, "VALIDATION", "Missing fields");
  if (roleKey === "PLATFORM_SUPER_ADMIN" && !ctx.isPlatform) {
    return fail(res, "FORBIDDEN", "Cannot assign platform role", 403);
  }
  const role = await prisma.role.findFirst({
    where: { key: roleKey, OR: [{ tenantId: ctx.tenantId! }, { tenantId: null }] },
  });
  if (!role) return fail(res, "NOT_FOUND", "Role not found", 404);

  const user = await prisma.user.create({
    data: {
      name,
      email: String(email).toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      tenants: { create: { tenantId: ctx.tenantId! } },
      roles: { create: { roleId: role.id } },
      branches: {
        create: (branchIds as string[] | undefined)?.map((branchId) => ({ branchId })) ?? [],
      },
    },
    include: { roles: { include: { role: true } }, branches: true },
  });
  const { passwordHash: _, ...safe } = user;
  await prisma.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorUserId: ctx.userId,
      action: "user.create",
      entityType: "User",
      entityId: user.id,
      after: { email: user.email, roleKey },
    },
  });
  return ok(res, safe, undefined, 201);
});

usersRouter.post("/:id/deactivate", requirePermission("user.manage"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const member = await prisma.userTenant.findFirst({
    where: { userId: String(req.params.id), tenantId: ctx.tenantId! },
  });
  if (!member) return fail(res, "NOT_FOUND", "User not in tenant", 404);
  const user = await prisma.user.update({
    where: { id: String(req.params.id) },
    data: { status: "DEACTIVATED" },
  });
  const { passwordHash: _, ...safe } = user;
  await prisma.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actorUserId: ctx.userId,
      action: "user.deactivate",
      entityType: "User",
      entityId: user.id,
    },
  });
  return ok(res, safe);
});

usersRouter.get("/roles", requirePermission("user.manage"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const roles = await prisma.role.findMany({
    where: { OR: [{ tenantId: ctx.tenantId! }, { tenantId: null }] },
  });
  return ok(res, roles.filter((r) => r.key !== "PLATFORM_SUPER_ADMIN" || ctx.isPlatform));
});
