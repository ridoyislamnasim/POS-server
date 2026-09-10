import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { fail } from "../lib/envelope.js";
import type { AuthedRequest, RequestContext } from "../types.js";

function requireSecret(name: string, fallback: string) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} must be set in production`);
  }
  return fallback;
}

const secret = requireSecret("JWT_SECRET", "dev-jwt-secret-change-me");
const refreshSecret = requireSecret("JWT_REFRESH_SECRET", "dev-refresh");

export function signAccess(payload: { sub: string; tenantId: string | null; sid?: string }) {
  return jwt.sign(payload, secret, { expiresIn: "8h" });
}

export function signRefresh(payload: { sub: string; sid: string }) {
  return jwt.sign(payload, refreshSecret, {
    expiresIn: "7d",
  });
}

export function businessDateInTz(tz = "Asia/Dhaka") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : req.cookies?.pos_access;
  if (!token) return fail(res, "UNAUTHORIZED", "Sign in required", 401);
  try {
    const decoded = jwt.verify(token, secret) as { sub: string; tenantId: string | null; sid?: string };
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      include: {
        tenants: true,
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        branches: true,
      },
    });
    if (!user || user.status !== "ACTIVE") return fail(res, "UNAUTHORIZED", "Account inactive", 401);

    if (decoded.sid) {
      const session = await prisma.session.findUnique({ where: { id: decoded.sid } });
      if (
        !session ||
        session.userId !== user.id ||
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now()
      ) {
        return fail(res, "UNAUTHORIZED", "Invalid session", 401);
      }
    }

    const membership = decoded.tenantId
      ? user.tenants.find((t) => t.tenantId === decoded.tenantId)
      : user.tenants.find((t) => t.isPlatform) ?? user.tenants[0];
    if (!membership) return fail(res, "FORBIDDEN", "Tenant access revoked", 403);
    const tenantId = membership.tenantId;
    const tenantRoles = user.roles.filter((r) => r.role.tenantId == null || r.role.tenantId === tenantId);
    const permissions = [
      ...new Set(
        tenantRoles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)),
      ),
    ];
    const ctx: RequestContext = {
      userId: user.id,
      tenantId,
      sessionId: decoded.sid,
      isPlatform: membership.isPlatform ?? false,
      branchIds: user.branches.map((b) => b.branchId),
      allBranches: membership.allBranches ?? false,
      permissions,
      roles: tenantRoles.map((r) => r.role.key),
      businessDate: businessDateInTz(),
    };
    (req as AuthedRequest).ctx = ctx;
    next();
  } catch {
    return fail(res, "UNAUTHORIZED", "Invalid session", 401);
  }
}

export function requirePermission(key: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = (req as AuthedRequest).ctx;
    if (ctx?.isPlatform || ctx?.roles?.includes("TENANT_OWNER") || ctx?.permissions.includes(key)) {
      return next();
    }
    return fail(res, "FORBIDDEN", "Missing permission", 403);
  };
}

export function requireTenant(req: Request, res: Response, next: NextFunction) {
  const ctx = (req as AuthedRequest).ctx;
  if (!ctx?.tenantId) return fail(res, "FORBIDDEN", "Tenant required", 403);
  next();
}
