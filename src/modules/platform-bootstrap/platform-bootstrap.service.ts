import bcrypt from "bcryptjs";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../utils/errors.js";
import { Permissions } from "../../shared/permissions.js";
import type { BootstrapPlatformBody } from "./platform-bootstrap.validation.js";

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60_000;
const attemptsByIp = new Map<string, number[]>();

function bootstrapEnabled() {
  return (process.env.ALLOW_PLATFORM_BOOTSTRAP ?? "1") !== "0";
}

function expectedToken(): string | null {
  const raw = (process.env.PLATFORM_BOOTSTRAP_TOKEN ?? "").trim();
  if (raw) return raw;
  if (process.env.NODE_ENV === "production") {
    throw new AppError("FORBIDDEN", "Bootstrap is not configured", 403);
  }
  return null;
}

function tokenMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function checkRateLimit(ip: string) {
  const now = Date.now();
  const hits = (attemptsByIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_ATTEMPTS) {
    throw new AppError("FORBIDDEN", "Too many attempts. Try later.", 429);
  }
  hits.push(now);
  attemptsByIp.set(ip, hits);
}

function stripPassword<T extends { passwordHash?: unknown }>(user: T): Omit<T, "passwordHash"> {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

export const platformBootstrapService = {
  async bootstrap(input: BootstrapPlatformBody, meta: { ip?: string; userAgent?: string }) {
    if (!bootstrapEnabled()) {
      throw new AppError("FORBIDDEN", "Bootstrap is disabled", 403);
    }

    const expected = expectedToken();
    const provided =
      (input as Record<string, unknown>).setupKey ??
      (input as Record<string, unknown>).bootstrapToken;
    // Header is checked in the controller; body token is accepted here only
    // so tests/clients without custom headers still work. Never log it.
    const headerToken = (meta as { bootstrapToken?: unknown }).bootstrapToken;
    const candidate = typeof headerToken === "string" ? headerToken : provided;
    if (expected && !tokenMatches(candidate, expected)) {
      checkRateLimit(meta.ip ?? "unknown");
      throw new AppError("FORBIDDEN", "Invalid bootstrap token", 403);
    }
    checkRateLimit(meta.ip ?? "unknown");

    // One-time gate: a platform admin already exists -> closed.
    const existingPlatform = await prisma.userTenant.count({ where: { isPlatform: true } });
    if (existingPlatform > 0) {
      throw new AppError("FORBIDDEN", "Already initialized", 410);
    }
    const existingRoleCount = await prisma.userRole.count({
      where: { role: { key: "PLATFORM_SUPER_ADMIN", tenantId: null } },
    });
    if (existingRoleCount > 0) {
      throw new AppError("FORBIDDEN", "Already initialized", 410);
    }

    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();

    const tenant = input.tenantId
      ? await prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true } })
      : await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!tenant) {
      throw new AppError("VALIDATION", "No tenant available for bootstrap", 400);
    }

    const user = await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction to close the race between two concurrent calls.
      const raced = await tx.userTenant.count({ where: { isPlatform: true } });
      if (raced > 0) {
        throw new AppError("FORBIDDEN", "Already initialized", 410);
      }

      let role = await tx.role.findFirst({
        where: { key: "PLATFORM_SUPER_ADMIN", tenantId: null },
      });
      if (!role) {
        role = await tx.role.create({
          data: { tenantId: null, key: "PLATFORM_SUPER_ADMIN", name: "Platform super admin" },
        });
      }
      // Ensure the global platform role holds every permission (same as seed/sync).
      const permissions = await tx.permission.findMany({
        where: { key: { in: [...Permissions] } },
        select: { id: true },
      });
      if (permissions.length) {
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
          skipDuplicates: true,
        });
      }

      const created = await tx.user.create({
        data: {
          name,
          email,
          passwordHash: await bcrypt.hash(input.password, 12),
          tenants: { create: { tenantId: tenant.id, allBranches: true, isPlatform: true } },
          roles: { create: { roleId: role.id } },
        },
        include: { roles: { include: { role: true } }, tenants: true },
      });
      return created;
    });

    await writeAudit({
      tenantId: tenant.id,
      userId: user.id,
      actorUserId: user.id,
      action: "platform.bootstrap",
      entityType: "User",
      entityId: user.id,
      after: { email: user.email, tenantId: tenant.id },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { ...stripPassword(user), tenantId: tenant.id };
  },
};
