import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, signAccess, signRefresh } from "../../middleware/auth.js";
import { clearAuthCookies, setAuthCookies } from "../../lib/cookies.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password, tenantId } = req.body ?? {};
  if (!email || !password) return fail(res, "VALIDATION", "Email and password required");
  const user = await prisma.user.findUnique({
    where: { email: String(email).toLowerCase() },
    include: {
      tenants: { include: { tenant: true } },
      roles: { include: { role: true } },
      branches: { include: { branch: true } },
    },
  });
  const recent = await prisma.loginAttempt.count({
    where: {
      email: String(email).toLowerCase(),
      createdAt: { gt: new Date(Date.now() - 15 * 60_000) },
      success: false,
    },
  });
  if (recent >= 8) return fail(res, "FORBIDDEN", "Account locked. Try later.", 429);

  const good = user && (await bcrypt.compare(password, user.passwordHash));
  await prisma.loginAttempt.create({
    data: { email: String(email).toLowerCase(), success: Boolean(good), ip: req.ip },
  });
  if (!user || !good || user.status !== "ACTIVE") {
    return fail(res, "UNAUTHORIZED", "Invalid email or password", 401);
  }
  const membership = tenantId
    ? user.tenants.find((t) => t.tenantId === tenantId)
    : user.tenants[0];
  if (!membership) return fail(res, "FORBIDDEN", "No tenant access", 403);

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    },
  });
  const access = signAccess({ sub: user.id, tenantId: membership.tenantId });
  const refresh = signRefresh({ sub: user.id, sid: session.id });
  await prisma.session.update({
    where: { id: session.id },
    data: { refreshTokenHash: createHash("sha256").update(refresh).digest("hex") },
  });
  const csrf = randomBytes(24).toString("hex");
  setAuthCookies(res, access, refresh, csrf);

  await writeAudit({
    tenantId: membership.tenantId,
    userId: user.id,
    actorUserId: user.id,
    action: "login",
    entityType: "Session",
    entityId: user.id,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });

  return ok(res, {
    accessToken: access,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      locale: user.locale,
      roles: user.roles.map((r) => r.role.key),
      tenant: membership.tenant,
      branches: user.branches.map((b) => b.branch),
      allBranches: membership.allBranches,
      isPlatform: membership.isPlatform,
    },
  });
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  await writeAudit({
    ctx,
    action: "logout",
    entityType: "Session",
    entityId: ctx.userId,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });
  clearAuthCookies(res);
  return ok(res, { signedOut: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    include: {
      tenants: { include: { tenant: true } },
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      branches: {
        include: { branch: { include: { location: true, registers: { include: { devices: true } } } } },
      },
    },
  });
  if (!user) return fail(res, "UNAUTHORIZED", "Not found", 401);
  const branchInclude = { location: true, registers: { include: { devices: true } } } as const;
  const branches =
    ctx.allBranches || ctx.isPlatform
      ? await prisma.branch.findMany({
          where: { tenantId: ctx.tenantId! },
          include: branchInclude,
        })
      : user.branches.map((b) => b.branch);
  return ok(res, {
    id: user.id,
    name: user.name,
    email: user.email,
    locale: user.locale,
    permissions: ctx.permissions,
    roles: ctx.roles,
    tenantId: ctx.tenantId,
    tenants: user.tenants.map((t) => t.tenant),
    branches,
    allBranches: ctx.allBranches,
    isPlatform: ctx.isPlatform,
  });
});
