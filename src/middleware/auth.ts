import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { fail } from "../lib/envelope.js";
import type { AuthedRequest, RequestContext } from "../types.js";

const secret = process.env.JWT_SECRET ?? "dev-jwt-secret-change-me";

export function signAccess(payload: { sub: string; tenantId: string | null }) {
  return jwt.sign(payload, secret, { expiresIn: "8h" });
}

export function signRefresh(payload: { sub: string; sid: string }) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET ?? "dev-refresh", {
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
    const decoded = jwt.verify(token, secret) as { sub: string; tenantId: string | null };
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      include: {
        tenants: true,
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        branches: true,
      },
    });
    if (!user || user.status !== "ACTIVE") return fail(res, "UNAUTHORIZED", "Account inactive", 401);

    const membership = user.tenants.find((t) => t.tenantId === decoded.tenantId) ?? user.tenants[0];
    const tenantId = membership?.tenantId ?? decoded.tenantId;
    const permissions = [
      ...new Set(
        user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)),
      ),
    ];
    const ctx: RequestContext = {
      userId: user.id,
      tenantId,
      isPlatform: membership?.isPlatform ?? false,
      branchIds: user.branches.map((b) => b.branchId),
      allBranches: membership?.allBranches ?? false,
      permissions,
      roles: user.roles.map((r) => r.role.key),
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
    if (!ctx?.permissions.includes(key) && !ctx?.isPlatform) {
      return fail(res, "FORBIDDEN", "Missing permission", 403);
    }
    next();
  };
}

export function requireTenant(req: Request, res: Response, next: NextFunction) {
  const ctx = (req as AuthedRequest).ctx;
  if (!ctx?.tenantId) return fail(res, "FORBIDDEN", "Tenant required", 403);
  next();
}
